// Supabase Edge Function: match_driver
// HARDENED - Secure auth via supabase.auth.getUser()
// FIXED: Direct driver query instead of RPC
// Phase 5: Sends push notification to matched driver via FCM HTTP v1 API
//
// Matches a driver to a ride request.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushNotification } from "../_shared/push.ts";
import { sendWhatsApp, getDeepLink } from "../_shared/sms.ts";
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

        // Verify caller owns this ride
        if (ride.rider_id !== userId) {
            return new Response(
                JSON.stringify({ success: false, error: "Forbidden: you can only match drivers to your own rides" }),
                { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
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
        let redisFailed = false;
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
            redisFailed = true;
            // CRITICAL FIX: When Redis fails, we query ALL drivers, not empty set
            candidateIds = [];
        }

        // ── EMERGENCY FIX: Redis Fallback Logic ─────────────────────────────────
        // Determine whether to use candidate list or query all drivers
        // - If Redis succeeded and found candidates: use those (fast path)
        // - If Redis succeeded but empty: query all drivers (Redis shows none nearby)
        // - If Redis failed: query all drivers (fallback to full DB scan)
        const useCandidateList = candidateIds.length > 0;
        const redisEmptyButWorking = candidateIds.length === 0 && !redisFailed;
        
        if (redisFailed) {
            console.log("Redis failed - falling back to full database scan for all drivers");
        } else if (redisEmptyButWorking) {
            console.log("Redis returned empty (no nearby drivers) - querying full database");
        }

        // NEW: Atomic, race-safe driver selection (Fix 1)
        // FIX: When Redis fails or returns empty, pass NULL to query ALL drivers
        // When Redis returns candidates, pass those IDs for optimized search
        const { data: claimedDrivers, error: claimError } = await supabaseAdmin
            .rpc("claim_available_driver", {
                p_pickup_lat: ride.pickup_lat,
                p_pickup_lng: ride.pickup_lng,
                p_vehicle_type: ride.vehicle_type || "Any",
                p_rider_id: ride.rider_id,
                p_max_distance_km: 15,
                p_candidate_ids: useCandidateList ? candidateIds : null // null = query all available drivers
            });

        if (claimError || !claimedDrivers || claimedDrivers.length === 0) {
            console.log("No live drivers available. Trying bot fallback...");

            // Bot fallback: assign closest online bot driver
            const { data: botDrivers } = await supabaseAdmin
                .from("drivers")
                .select("id, name, lat, lng, vehicle_type, vehicle_model, plate_number, rating")
                .eq("is_bot", true)
                .eq("is_online", true)
                .eq("status", "online")
                .limit(5);

            if (botDrivers && botDrivers.length > 0) {
                const pickClosest = (drivers: any[]) =>
                    drivers.reduce((closest, driver) => {
                        const dist = Math.sqrt(
                            Math.pow(driver.lat - ride.pickup_lat, 2) +
                            Math.pow(driver.lng - ride.pickup_lng, 2)
                        );
                        return (!closest || dist < closest.dist) ? { ...driver, dist } : closest;
                    }, null);

                const botDriver = pickClosest(botDrivers);
                if (botDriver) {
                    const { error: assignError } = await supabaseAdmin
                        .from("rides")
                        .update({ driver_id: botDriver.id, status: "assigned", updated_at: new Date().toISOString() })
                        .eq("id", ride_id)
                        .in("status", ["requested", "searching", "waiting_queue"]);

                    if (!assignError) {
                        await supabaseAdmin.from("drivers").update({ status: "busy" }).eq("id", botDriver.id);
                        console.log(`Bot driver ${botDriver.id} assigned to ride ${ride_id}`);
                        return new Response(JSON.stringify({
                            success: true, data: { ride_id, status: "assigned", driver: botDriver },
                            message: `Bot driver ${botDriver.name} assigned`,
                        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                    }
                }
            }

            console.log("No bot drivers either. Moving to waiting_queue.");
            await supabaseAdmin
                .from("rides")
                .update({ status: "waiting_queue" })
                .eq("id", ride_id)
                .in("status", ["searching", "requested"]);
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

        // Read platform rate from pricing_config; fallback to 0.15
        const { data: platRateRow } = await supabaseAdmin
            .from("pricing_config")
            .select("value_cents")
            .eq("key", "PLATFORM_RATE_CENTS")
            .maybeSingle()
            .catch(() => ({ data: null }));
        const platRate = platRateRow ? (platRateRow.value_cents ?? 1500) / 10000 : 0.15;
        // Pioneer tier gets 3% lower rate
        const commissionRate = selectedDriver.commission_tier === 'pioneer'
            ? Math.max(0.01, platRate - 0.03)
            : platRate;

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
        await supabaseAdmin.from("rides").update({ status: "searching" }).eq("id", ride_id).in("status", ["requested", "searching", "waiting_queue", "expired"]);

        // ── TRUST SCORE: Calculate for this ride ───────────────────────────
        let trustBadge = 'STANDARD';
        let trustScore = 0;
        try {
            const { data: trustResult } = await supabaseAdmin
                .rpc("calculate_ride_trust_score", {
                    p_rider_id: ride.rider_id,
                    p_pickup_lat: ride.pickup_lat,
                    p_pickup_lng: ride.pickup_lng,
                    p_dropoff_lat: ride.dropoff_lat || ride.pickup_lat,
                    p_dropoff_lng: ride.dropoff_lng || ride.pickup_lng,
                });

            if (trustResult) {
                const result = Array.isArray(trustResult) ? trustResult[0] : trustResult;
                trustBadge = result.badge || 'STANDARD';
                trustScore = result.final_score || result.score || 0;

                // Add trust network bonus
                const { data: networkMemberships } = await supabaseAdmin
                    .from("trust_network_members")
                    .select("network_id")
                    .eq("user_id", ride.rider_id);

                if (networkMemberships && networkMemberships.length > 0) {
                    const netIds = networkMemberships.map((n: any) => n.network_id);
                    const { data: networks } = await supabaseAdmin
                        .from("trust_networks")
                        .select("trust_bonus")
                        .in("id", netIds);

                    if (networks) {
                        const bonus = networks.reduce((s: number, n: any) => s + (n.trust_bonus || 0), 0);
                        trustScore = Math.min(100, trustScore + bonus);
                        if (trustScore >= 50) trustBadge = 'VERIFIED_SAFE';
                        else if (trustScore >= 30) trustBadge = 'SAFE_ROUTE';
                    }
                }
            }
        } catch {
            console.log("Trust score calculation failed (non-fatal)");
        }

        // ── Phase 5 Fix 5.6: Push notification to the matched driver ─────────
        // Fire-and-forget — push failure must never block the offer creation.
        // The driver's app also listens via Realtime subscription as a fallback.
        if (selectedDriver.push_token) {
            sendPushNotification(
                selectedDriver.push_token,
                trustBadge === 'VERIFIED_SAFE' ? '✅ Verified Safe Ride' :
                trustBadge === 'SAFE_ROUTE' ? '🛡️ Safe Route' : '🚖 New Ride Request',
                trustBadge !== 'STANDARD'
                    ? `Trust Score ${trustScore}/100 · Rider is in your safety network.`
                    : 'A rider is waiting nearby. Tap to view the offer.',
                {
                    type: 'NEW_RIDE_OFFER',
                    ride_id: ride.id,
                    pickup: ride.pickup_address || '',
                    driver_payout_cents: driverPayout.toString(),
                    trust_score: trustScore.toString(),
                    trust_badge: trustBadge,
                }
            ).catch(err => console.error("Push notification failed (non-fatal):", err));
        } else {
            console.log(`Driver ${selectedDriver.id} has no push_token — skipping push, relying on Realtime.`);
        }

        if (selectedDriver.phone_number) {
            const waMsg = `G-TAXI: New Ride Request at ${ride.pickup_address || 'nearby location'}. Tap to view.`;
            sendWhatsApp(selectedDriver.phone_number, waMsg)
                .then(r => {
                    if (!r.success) console.log(`[MatchDriver] WhatsApp unavailable — ${r.error || r.channel}`);
                })
                .catch(err => console.error("[MatchDriver] WhatsApp fallback failed (non-fatal):", err));
        } else {
            console.log(`Driver ${selectedDriver.id} has no phone_number — skipping WhatsApp fallback.`);
        }

        return new Response(
            JSON.stringify({
                success: true,
                data: {
                    ride_id,
                    status: "searching",
                    message: "Offer sent to driver",
                    trust_score: trustScore,
                    trust_badge: trustBadge,
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
