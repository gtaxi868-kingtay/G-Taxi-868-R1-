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
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";


serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
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

        // What the driver will actually be paid: compute_ride_split's driver_net
        // (80%, or 78% while their recruiter is an active commander), via
        // estimate_offer_driver_payout -- the same source process_dispatch_queue
        // uses. This used to be fare x (1 - PLATFORM_RATE) = 85% (88% for
        // "pioneer"), which compute_ride_split never pays (live 2026-10-15: offer
        // said TT$29.11, ride settled TT$27.40). If the estimate fails, fall back
        // to the LOWEST base share (78%): an offer may under-state, never over-state.
        const totalFare = ride.total_fare_cents || 0;
        const { data: payoutEstimate, error: payoutErr } = await supabaseAdmin.rpc("estimate_offer_driver_payout", {
            p_gross_cents: totalFare,
            p_driver_id: selectedDriver.id,
        });
        if (payoutErr) console.error("estimate_offer_driver_payout failed, using 78% floor:", payoutErr.message);
        const driverPayout = typeof payoutEstimate === "number" && !payoutErr
            ? payoutEstimate
            : Math.round(totalFare * 0.78);

        // Time-limited ride offer: 30 s, same as process_dispatch_queue (15 s
        // expired before a driver could switch apps and tap Accept).
        const expiresAt = new Date(Date.now() + 30 * 1000).toISOString();
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

        // ── Merchant-originated ride: business name + location + live distance ──
        // billed_to_merchant_id is set for the kiosk-summon path always, but only
        // conditionally (payment_method === 'corporate_billing') for concierge
        // dispatch — so it is not a reliable "is this a merchant ride" signal on
        // its own. ride.metadata.merchant_name is written on BOTH dispatch paths
        // regardless of billing, so that is the real detection + display-name
        // source; billed_to_merchant_id (when present) is used only to fetch a
        // clean address for the location field.
        const merchantName: string | null = ride.metadata?.merchant_name ?? null;
        const isMerchantRide = Boolean(ride.metadata?.is_merchant_dispatch || ride.metadata?.is_concierge || merchantName);

        let pushTitle: string;
        let pushBody: string;
        let waMsg: string;

        if (isMerchantRide && merchantName) {
            let location: string | null = null;

            if (ride.billed_to_merchant_id) {
                const { data: merchantRow } = await supabaseAdmin
                    .from("merchants")
                    .select("address, lat, lng")
                    .eq("id", ride.billed_to_merchant_id)
                    .maybeSingle();

                if (merchantRow?.address) {
                    location = merchantRow.address;
                } else if (merchantRow?.lat != null && merchantRow?.lng != null) {
                    // No stored address — reverse-geocode via the same Mapbox
                    // integration already used in create_safe_zone/index.ts,
                    // rather than adding a new geocoding dependency.
                    const mapboxToken = Deno.env.get("MAPBOX_PUBLIC_TOKEN") || Deno.env.get("MAPBOX_ACCESS_TOKEN");
                    if (mapboxToken) {
                        try {
                            const geoUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${merchantRow.lng},${merchantRow.lat}.json?types=address&limit=1&access_token=${mapboxToken}`;
                            const geoRes = await fetch(geoUrl);
                            if (geoRes.ok) {
                                const geoJson = await geoRes.json();
                                location = geoJson.features?.[0]?.place_name ?? null;
                            }
                        } catch (geoErr) {
                            console.error("[MatchDriver] Mapbox reverse geocode failed (non-fatal):", geoErr);
                        }
                    }
                }
            }

            // Last resort: pickup_address is always set to a merchant-name +
            // address string for merchant rides — never leave location blank.
            if (!location) location = ride.pickup_address || "location pending";

            // Distance: claim_available_driver already computed distance_km for
            // this exact driver against this exact pickup point — reuse it
            // rather than recomputing. Only trust it if the driver's location is
            // actually fresh: drivers.last_location_update is the same column
            // cleanup_stale_drivers() uses to decide a driver has gone dark (at
            // a much looser 5-minute bar, since that check is "still online at
            // all"). Foreground/background tracking pushes a packet every 5s
            // under normal conditions (apps/driver/src/hooks/useLocationTracking.ts,
            // TIME_INTERVAL_MS), so 120s here is a generous multiple of that —
            // tolerant of a missed beat or two, still tight enough that the
            // number shown is meaningfully true. This is a reasoned threshold,
            // not one backed by observed traffic — this platform has had zero
            // real completed rides to measure actual update cadence against.
            const lastUpdate = selectedDriver.last_location_update ? new Date(selectedDriver.last_location_update).getTime() : null;
            const locationFreshEnough = lastUpdate !== null && (Date.now() - lastUpdate) <= 120_000;
            const distanceKm = typeof selectedDriverSummary.distance_km === "number" ? selectedDriverSummary.distance_km : null;

            const headline = (locationFreshEnough && distanceKm !== null)
                ? `${merchantName} · ${location} · ${distanceKm.toFixed(1)}km away`
                : `${merchantName} · ${location}`;

            pushTitle = headline;
            pushBody = "New ride request — accept in app";
            waMsg = `${headline}\nNew ride request — accept in app`;
        } else {
            pushTitle = trustBadge === 'VERIFIED_SAFE' ? '✅ Verified Safe Ride' :
                trustBadge === 'SAFE_ROUTE' ? '🛡️ Safe Route' : '🚖 New Ride Request';
            pushBody = trustBadge !== 'STANDARD'
                ? `Trust Score ${trustScore}/100 · Rider is in your safety network.`
                : 'A rider is waiting nearby. Tap to view the offer.';
            waMsg = `G-TAXI: New Ride Request at ${ride.pickup_address || 'nearby location'}. Tap to view.`;
        }

        // ── Phase 5 Fix 5.6: Push notification to the matched driver ─────────
        // Fire-and-forget — push failure must never block the offer creation.
        // The driver's app also listens via Realtime subscription as a fallback.
        if (selectedDriver.push_token) {
            sendPushNotification(
                selectedDriver.push_token,
                pushTitle,
                pushBody,
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
