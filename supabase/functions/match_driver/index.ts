// Supabase Edge Function: match_driver
// HARDENED - Secure auth via supabase.auth.getUser()
// FIXED: Direct driver query instead of RPC
// Phase 5: Sends push notification to matched driver via FCM HTTP v1 API
//
// Matches a driver to a ride request.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushNotification } from "../_shared/push.ts";
import { sendSMS } from "../_shared/sms.ts";
import { captureException } from "../_shared/sentry.ts";
import { redisCommand } from "../_shared/redis.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        // 1. Initialize Supabase Client with Auth Context (using ANON KEY + user JWT)
        const supabaseClient = createClient(
            SUPABASE_URL,
            SUPABASE_ANON_KEY,
            {
                global: {
                    headers: { Authorization: req.headers.get("Authorization")! },
                },
            }
        );

        // 2. AUTHENTICATION (The Gatekeeper)
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

        if (authError || !user) {
            return new Response(
                JSON.stringify({ success: false, error: "Unauthorized: Valid JWT required" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const userId = user.id;
        console.log("Verified user ID for matching:", userId);

        // Parse request body
        const { ride_id } = await req.json();
        if (!ride_id) {
            return new Response(JSON.stringify({ success: false, error: "ride_id required" }), { status: 400, headers: corsHeaders });
        }

        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // Get ride
        const { data: ride, error: rideError } = await supabaseAdmin.from("rides").select("*").eq("id", ride_id).single();
        if (rideError || !ride) {
            return new Response(JSON.stringify({ success: false, error: "Ride not found" }), { status: 404, headers: corsHeaders });
        }

        // --- Fix 4.7: Skip rides that have admin override active ---
        if (ride.admin_override === true) {
            console.log(`Skipping match for ride ${ride_id} - admin_override is ON.`);
            return new Response(
                JSON.stringify({ success: false, error: "Admin override active", data: null }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 1. Get previously offered drivers (exclusions)
        const { data: previousOffers } = await supabaseAdmin.from("ride_offers").select("driver_id").eq("ride_id", ride_id);
        const excludedDriverIds = previousOffers?.map((o: any) => o.driver_id) || [];

        // NEW: Pull Candidates from REDIS FIRST (The Scaling Fix)
        let candidateIds: string[] = [];
        try {
            // GEORADIUS active_drivers {lng} {lat} 15 km
            const redisResults = await redisCommand([
                "GEORADIUS",
                "active_drivers",
                ride.pickup_lng.toString(),
                ride.pickup_lat.toString(),
                "15",
                "km",
                "COUNT", "20" // Only pull top 20 closest to keep SQL scoring fast
            ]);
            candidateIds = redisResults || [];
            
            // Filter out drivers we already offered the ride to
            candidateIds = candidateIds.filter(id => !excludedDriverIds.includes(id));
            
            console.log(`Redis found ${candidateIds.length} candidates nearby.`);
        } catch (redisErr) {
            console.error("Redis candidate fetch failed, falling back to full table search:", redisErr);
            // We'll leave candidateIds empty to trigger the high-cost DB fallback if needed
        }

        // 2. If Redis is empty and we had a succesful connection, we skip the DB scan entirely
        if (candidateIds.length === 0) {
            console.log("No candidates in range via Redis. Skipping SQL scan.");
        }

        // NEW: Atomic, race-safe driver selection (Fix 1)
        const { data: claimedDrivers, error: claimError } = await supabaseAdmin
            .rpc("claim_available_driver", {
                p_pickup_lat: ride.pickup_lat,
                p_pickup_lng: ride.pickup_lng,
                p_vehicle_type: ride.vehicle_type || "Any",
                p_rider_id: ride.rider_id, // Fix 6: Mutual Blacklist
                p_max_distance_km: 15,
                p_candidate_ids: candidateIds.length > 0 ? candidateIds : null // Pass Redis IDs
            });

        if (claimError || !claimedDrivers || claimedDrivers.length === 0) {
            console.log("No drivers available/claimed via RPC. Moving to waiting_queue.");
            await supabaseAdmin
                .from("rides")
                .update({ status: "waiting_queue" })
                .eq("id", ride_id);
            return new Response(
                JSON.stringify({ success: false, error: "No drivers available", data: null }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const selectedDriverSummary = claimedDrivers[0];
        // The RPC returns driver_id, driver_name, etc. but we need push_token for later.
        // We'll fetch the full record for the selected driver to get push_token.
        const { data: selectedDriver } = await supabaseAdmin
            .from("drivers")
            .select("*")
            .eq("id", selectedDriverSummary.driver_id)
            .single();

        if (!selectedDriver) {
            console.error("Critical: Driver claimed via RPC but record not found:", selectedDriverSummary.driver_id);
            return new Response(JSON.stringify({ success: false, error: "Internal error" }), { status: 500, headers: corsHeaders });
        }

        // Append distance for the offer insertion below
        selectedDriver._distance = selectedDriverSummary.distance_km * 1000;

        // Calculate Payout based on Commission Tier (Phase 11.5)
        let commissionRate = 0.22; // Default Standard
        if (selectedDriver.commission_tier === 'pioneer') {
            commissionRate = 0.19;
        }
        // User Feedback: 17% tier removed to protect margins
        
        const totalFare = ride.total_fare_cents || 0;
        const driverPayout = Math.round(totalFare * (1 - commissionRate));

        // Create Time-Limited Ride Offer (15 seconds)
        const expiresAt = new Date(Date.now() + 15 * 1000).toISOString();
        const { error: insertError } = await supabaseAdmin
            .from("ride_offers")
            .insert({
                ride_id: ride.id,
                driver_id: selectedDriver.id,
                status: "pending",
                distance_meters: Math.round(selectedDriver._distance),
                driver_payout_cents: driverPayout, // Phase 11.5
                expires_at: expiresAt
            });

        if (insertError) {
            console.error("Failed to create offer:", insertError);
            return new Response(JSON.stringify({ success: false, error: "Failed to create offer" }), { status: 500, headers: corsHeaders });
        }

        // Ensure ride is strictly "searching", pulling it out of the queue if it was stuck
        await supabaseAdmin.from("rides").update({ status: "searching" }).eq("id", ride_id);

        // ── Phase 5 Fix 5.6: Push notification to the matched driver ─────────
        // Fire-and-forget — push failure must never block the offer creation.
        // The driver's app also listens via Realtime subscription as a fallback.
        if (selectedDriver.push_token) {
            sendPushNotification(
                selectedDriver.push_token,
                '🚖 New Ride Request',
                'A rider is waiting nearby. Tap to view the offer.',
                {
                    type: 'NEW_RIDE_OFFER',
                    ride_id: ride.id,
                    pickup: ride.pickup_address || '',
                    driver_payout_cents: driverPayout.toString(), // Phase 11.5
                }
            ).catch(err => console.error("Push notification failed (non-fatal):", err));
        } else {
            console.log(`Driver ${selectedDriver.id} has no push_token — skipping push, relying on Realtime.`);
        }

        // --- Fix 9: SMS Fallback for Edge Regions ---
        if (selectedDriver.phone_number) {
            const smsMsg = `G-TAXI: New Ride Request at ${ride.pickup_address || 'nearby location'}. Tap to view.`;
            sendSMS(selectedDriver.phone_number, smsMsg)
                .catch(err => console.error("SMS Fallback failed (non-fatal):", err));
        } else {
            console.log(`Driver ${selectedDriver.id} has no phone_number — skipping SMS fallback.`);
        }

        return new Response(
            JSON.stringify({
                success: true,
                data: {
                    ride_id,
                    status: "searching",
                    message: "Offer sent to driver"
                },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error: any) {
        console.error("match_driver error:", error);
        await captureException(error, { function: 'match_driver' });
        return new Response(JSON.stringify({ success: false, error: "Internal error" }), { status: 500, headers: corsHeaders });
    }
});
