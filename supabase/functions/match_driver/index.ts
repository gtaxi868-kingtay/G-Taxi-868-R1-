// Supabase Edge Function: match_driver
// HARDENED - Secure auth via supabase.auth.getUser()
// FIXED: Direct driver query instead of RPC
// Phase 5: Sends push notification to matched driver via FCM HTTP v1 API
//
// Matches a driver to a ride request.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushNotification } from "../_shared/push.ts";
import { captureException } from "../_shared/sentry.ts";

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

        // 1. Get previously offered drivers (exclusions)
        const { data: previousOffers } = await supabaseAdmin.from("ride_offers").select("driver_id").eq("ride_id", ride_id);
        const excludedDriverIds = previousOffers?.map((o: any) => o.driver_id) || [];

        // NEW: Atomic, race-safe driver selection (Fix 1)
        const { data: claimedDrivers, error: claimError } = await supabaseAdmin
            .rpc("claim_available_driver", {
                p_pickup_lat: ride.pickup_lat,
                p_pickup_lng: ride.pickup_lng,
                p_vehicle_type: ride.vehicle_type || "Any",
                p_max_distance_km: 15
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

        // Create Time-Limited Ride Offer (15 seconds)
        const expiresAt = new Date(Date.now() + 15 * 1000).toISOString();
        const { error: insertError } = await supabaseAdmin
            .from("ride_offers")
            .insert({
                ride_id: ride.id,
                driver_id: selectedDriver.id,
                status: "pending",
                distance_meters: Math.round(selectedDriver._distance),
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
                }
            ).catch(err => console.error("Push notification failed (non-fatal):", err));
        } else {
            console.log(`Driver ${selectedDriver.id} has no push_token — skipping push, relying on Realtime.`);
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
