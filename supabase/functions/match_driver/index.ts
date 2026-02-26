// Supabase Edge Function: match_driver
// HARDENED - Secure auth via supabase.auth.getUser()
// FIXED: Direct driver query instead of RPC
// Phase 5: Sends push notification to matched driver via FCM HTTP v1 API
//
// Matches a driver to a ride request.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushNotification } from "../_shared/push.ts";

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

        // 2. TIER 1 FAMILIARITY: Query rider's past 5-star drivers
        const { data: familiarRides } = await supabaseAdmin
            .from("rides")
            .select("driver_id")
            .eq("rider_id", ride.rider_id)
            .eq("rating", 5)
            .not("driver_id", "is", null);

        const familiarDriverIds = familiarRides?.map((r: any) => r.driver_id) || [];
        const validFamiliarIds = [...new Set(familiarDriverIds)].filter(id => !excludedDriverIds.includes(id));

        // 3. Find available live drivers
        const { data: availableDrivers, error: driverError } = await supabaseAdmin
            .from("drivers")
            .select("*")
            .or("status.eq.available,status.eq.online,is_online.eq.true");

        // PHASE 5: Cold Start Queueing
        if (driverError || !availableDrivers || availableDrivers.length === 0) {
            console.log("Phase 5 Queueing: No drivers online. Moving to waiting_queue.");
            await supabaseAdmin.from("rides").update({ status: "waiting_queue" }).eq("id", ride_id);

            // Trigger Admin Alert Webhook (Slack / Discord / Push)
            const webhookUrl = Deno.env.get("ADMIN_WEBHOOK_URL");
            if (webhookUrl) {
                // Fire and forget - don't block the rider response
                fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        event: "ride_queued",
                        ride_id,
                        message: "URGENT: A rider is in the queue but no drivers are online! Go online now.",
                        timestamp: new Date().toISOString()
                    })
                }).catch(e => console.error("Webhook failed:", e));
            }

            return new Response(JSON.stringify({ success: true, data: { status: "waiting_queue", message: "Queued" } }), { headers: corsHeaders });
        }

        // Exclude drivers who already declined or timed out
        let candidateDrivers = availableDrivers.filter((d: any) => !excludedDriverIds.includes(d.id));

        if (candidateDrivers.length === 0) {
            return new Response(JSON.stringify({ success: false, error: "NO_DRIVERS" }), { status: 404, headers: corsHeaders });
        }

        // PHASE 8: The -$600 TTD Lockout Trapdoor
        // Fetch wallet balances to ensure we don't dispatch to drivers who owe too much commission
        const candidateIds = candidateDrivers.map((d: any) => d.id);
        const { data: balances } = await supabaseAdmin
            .from("wallet_transactions")
            .select("user_id, amount")
            .in("user_id", candidateIds)
            .eq("status", "completed");

        const walletMap: Record<string, number> = {};
        if (balances) {
            balances.forEach((b: any) => {
                walletMap[b.user_id] = (walletMap[b.user_id] || 0) + Number(b.amount);
            });
        }

        // Lockout drivers with balance <= -60000 cents (-600 TTD)
        candidateDrivers = candidateDrivers.filter((d: any) => {
            const bal = walletMap[d.id] || 0;
            if (bal <= -60000) {
                console.log(`Driver ${d.id} locked out due to debt: ${bal} cents`);
                return false;
            }
            return true;
        });

        if (candidateDrivers.length === 0) {
            return new Response(JSON.stringify({ success: false, error: "NO_DRIVERS" }), { status: 404, headers: corsHeaders });
        }

        // Haversine distance calculator
        function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
            const R = 6371e3;
            const f1 = lat1 * Math.PI / 180;
            const f2 = lat2 * Math.PI / 180;
            const df = (lat2 - lat1) * Math.PI / 180;
            const dl = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(df / 2) * Math.sin(df / 2) + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) * Math.sin(dl / 2);
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }

        candidateDrivers = candidateDrivers.map((d: any) => {
            const lat = d.lat || d.current_lat || d.latitude || 0;
            const lng = d.lng || d.current_lng || d.longitude || 0;
            return { ...d, _distance: getDistanceMeters(ride.pickup_lat, ride.pickup_lng, lat, lng) };
        });

        // Drop candidates > 15km away
        candidateDrivers = candidateDrivers.filter((d: any) => d._distance < 15000);

        if (candidateDrivers.length === 0) {
            return new Response(JSON.stringify({ success: false, error: "NO_DRIVERS_NEARBY" }), { status: 404, headers: corsHeaders });
        }

        // Sort Tiers
        const familiarCandidates = candidateDrivers.filter((d: any) => validFamiliarIds.includes(d.id));
        let selectedDriver = null;

        if (familiarCandidates.length > 0) {
            familiarCandidates.sort((a: any, b: any) => a._distance - b._distance);
            selectedDriver = familiarCandidates[0];
            console.log("Tier 1: Familiarity Match - Dispatching to", selectedDriver.id);
        } else {
            candidateDrivers.sort((a: any, b: any) => a._distance - b._distance);
            selectedDriver = candidateDrivers[0];
            console.log("Tier 2: Proximity Match - Dispatching to", selectedDriver.id);
        }

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

    } catch (error) {
        console.error("Match driver error:", error);
        return new Response(JSON.stringify({ success: false, error: "Internal error" }), { status: 500, headers: corsHeaders });
    }
});
