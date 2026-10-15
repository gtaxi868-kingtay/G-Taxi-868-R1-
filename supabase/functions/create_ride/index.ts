import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { calculateFare, calculateStopsFee, fetchVehicleClass } from "../_shared/pricing.ts";
import { captureException } from "../_shared/sentry.ts";
import { sendPushNotification } from "../_shared/push.ts";
import { secureFetch } from "../_shared/networkUtility.ts";

import { getCorsHeaders } from "../_shared/cors.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAPBOX_TOKEN = Deno.env.get("MAPBOX_ACCESS_TOKEN") ?? "";


function log(level: "INFO" | "ERROR", message: string, data: Record<string, any> = {}) {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message,
        function: "create_ride",
        ...data
    }));
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
    const requestId = crypto.randomUUID();

    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const supabaseClient = createClient(
            SUPABASE_URL,
            SUPABASE_ANON_KEY,
            {
                global: {
                    headers: { Authorization: req.headers.get("Authorization")! },
                },
            }
        );

        const {
            data: { user },
            error: authError,
        } = await supabaseClient.auth.getUser();

        if (authError || !user) {
            log("ERROR", "Auth failed", { error: authError, requestId });
            return new Response(
                JSON.stringify({ success: false, error: "Unauthorized: Valid JWT required" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const rider_id = user.id;

        let body;
        try {
            body = await req.json();
        } catch {
            log("ERROR", "Invalid JSON", { requestId, rider_id });
            return new Response(
                JSON.stringify({ success: false, error: "Invalid JSON body", data: null }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // ── Identity check: decided here from real evidence, not the app's flag ──
        // The rider app asks for a selfie only when a ride looks risky (first
        // ride on the device, late night, cash fare >= TT$150) and otherwise
        // sends identity_verified:false. This function used to refuse EVERY
        // ride without the flag, so a rider's second daytime ride always
        // failed with no selfie screen shown (and the AI-chat booking path,
        // which always sends false, could never book). It also believed a
        // bare `true` with no photo behind it.
        // Now: the rider's own uploads in verification-photos/<uid>/ decide.
        //   - a selfie in the last 30 min  -> verified for this ride
        //   - an older selfie, daytime     -> trusted (the app's rule), except
        //                                     cash >= TT$150, checked once the
        //                                     fare is known, further down
        //   - otherwise                    -> selfie required (same 403 as before)
        const SELFIE_FRESH_MS = 30 * 60 * 1000;
        const ttHour = (new Date().getUTCHours() + 24 - 4) % 24; // Trinidad & Tobago is UTC-4, no DST
        const isLateNightTT = ttHour >= 22 || ttHour < 5;
        const { data: selfies } = await adminClient.storage
            .from("verification-photos")
            .list(rider_id, { limit: 1, sortBy: { column: "created_at", order: "desc" } })
            .then((res) => res, () => ({ data: null }));
        const latestSelfieAt = selfies?.[0]?.created_at ? new Date(selfies[0].created_at).getTime() : null;
        const hasFreshSelfie = latestSelfieAt !== null && Date.now() - latestSelfieAt <= SELFIE_FRESH_MS;
        const hasPriorSelfie = latestSelfieAt !== null;

        if (!hasFreshSelfie && (!hasPriorSelfie || isLateNightTT)) {
            log("ERROR", "Missing identity verification", { requestId, rider_id, hasPriorSelfie, isLateNightTT });
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "Identity verification required. Please complete the selfie check before requesting a ride."
                }),
                { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }
        const rateCheck = await checkRateLimit(adminClient, rider_id, "create_ride");
        if (!rateCheck.allowed) {
            return new Response(
                JSON.stringify({ success: false, error: rateCheck.error }),
                { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const {
            pickup_lat,
            pickup_lng,
            pickup_address = "Pickup Location",
            dropoff_lat,
            dropoff_lng,
            dropoff_address = "Destination",
            vehicle_type = "Standard",
            payment_method,
            scheduled_for,
            stops = [],
            source = "app",
            source_metadata = {},
            taxi_stand_id,
            kiosk_id,
            guest_name,
            guest_phone,
            billed_to_merchant_id,
            band_id,
            carnival_event_id,
            organizer_id,
            event_id,
            idempotency_key
        } = body;

        // ── INPUT VALIDATION ─────────────────────────────────────────────
        // Everything destructured above arrives from the client and is handed
        // to money-moving code downstream. Validate it here, once, before use.

        // 1. payment_method — complete_ride settles on an if/else-if chain with
        //    NO fallback branch (complete_ride/index.ts:445,486,543), and
        //    check_payment_completion_safety() likewise ends in a bare
        //    RETURN NEW. An unrecognised method therefore completes the ride,
        //    pays the driver and books platform revenue while charging the
        //    rider nothing. Allowlist it; never pass the raw value through.
        //    corporate_billing is deliberately NOT allowed here: it bills a
        //    merchant instead of the rider, and this endpoint cannot prove the
        //    caller is entitled to do that. B2B rides are created by
        //    merchant_gateway / merchant, which can.
        const ALLOWED_PAYMENT_METHODS = ["cash", "wallet", "card", "wipay"];
        const paymentMethod = String(payment_method ?? "cash").trim().toLowerCase();
        if (!ALLOWED_PAYMENT_METHODS.includes(paymentMethod)) {
            log("ERROR", "Rejected unsupported payment method", { requestId, rider_id, payment_method });
            return new Response(
                JSON.stringify({
                    success: false,
                    error: `Unsupported payment method. Choose one of: ${ALLOWED_PAYMENT_METHODS.join(", ")}.`,
                    data: null
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 2. billed_to_merchant_id — same class of bug verify_kiosk_origin()
        //    was written to close for kiosk_id. Accepting it from the body lets
        //    any rider bill a ride to any merchant, harvest that merchant's
        //    revenue share (log_platform_revenue), and trigger pin-fee debits
        //    against a merchant wallet with no tap, geofence or consent.
        //    The legitimate B2B paths set it from an AUTHENTICATED merchant and
        //    enforce the credit limit first; this endpoint can do neither.
        if (billed_to_merchant_id) {
            log("ERROR", "Rejected client-supplied billed_to_merchant_id", { requestId, rider_id });
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "Merchant billing is not available on this endpoint.",
                    data: null
                }),
                { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 3. stops — estimated_wait_minutes is multiplied by the per-minute rate
        //    and folded into the fare BEFORE the minimum-fare floor is applied,
        //    so a negative wait collapses any fare to the floor. That deflated
        //    fare is what the driver is paid from, so it steals from the driver
        //    as well as the platform. calculateStopsFee() now clamps the wait
        //    (see _shared/pricing.ts); reject malformed input outright here.
        //    stopList also replaces raw `stops` below: a non-array `stops`
        //    passed .length but crashed .map() AFTER the ride was already
        //    created and dispatched.
        // 10, not 5: the unmodified rider app can legitimately send 6 —
        // suggest_stops returns up to 6 suggestions and RideConfirmationScreen
        // lets the rider select all of them. The cap exists to bound abuse,
        // not to reject a normal booking from the current client.
        const MAX_STOPS = 10;
        const MAX_WAIT_MINUTES = 120;
        if (stops !== undefined && !Array.isArray(stops)) {
            log("ERROR", "Rejected non-array stops", { requestId, rider_id });
            return new Response(
                JSON.stringify({ success: false, error: "stops must be an array.", data: null }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }
        const stopList: any[] = Array.isArray(stops) ? stops : [];
        if (stopList.length > MAX_STOPS) {
            log("ERROR", "Rejected too many stops", { requestId, rider_id, count: stopList.length });
            return new Response(
                JSON.stringify({ success: false, error: `A ride can have at most ${MAX_STOPS} stops.`, data: null }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }
        for (const stop of stopList) {
            if (stop === null || typeof stop !== "object" || Array.isArray(stop)) {
                log("ERROR", "Rejected malformed stop", { requestId, rider_id });
                return new Response(
                    JSON.stringify({ success: false, error: "Each stop must be an object.", data: null }),
                    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            if (stop.estimated_wait_minutes !== undefined && stop.estimated_wait_minutes !== null) {
                const wait = Number(stop.estimated_wait_minutes);
                if (!Number.isFinite(wait) || wait < 0 || wait > MAX_WAIT_MINUTES) {
                    log("ERROR", "Rejected out-of-range stop wait", { requestId, rider_id, wait: stop.estimated_wait_minutes });
                    return new Response(
                        JSON.stringify({
                            success: false,
                            error: `estimated_wait_minutes must be between 0 and ${MAX_WAIT_MINUTES}.`,
                            data: null
                        }),
                        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                    );
                }
            }
        }
        // ── END INPUT VALIDATION ─────────────────────────────────────────

        log("INFO", "Request from verified user", { requestId, rider_id, vehicle_type, payment_method: paymentMethod, idempotency_key });

        if (idempotency_key) {
            const { data: existingByIdempotency } = await supabaseClient
                .from("rides")
                .select("*")
                .eq("rider_id", rider_id)
                .eq("idempotency_key", idempotency_key)
                .maybeSingle();

            if (existingByIdempotency) {
                log("INFO", "Idempotent hit: ride already exists", { ride_id: existingByIdempotency.id, idempotency_key });
                return new Response(
                    JSON.stringify({
                        success: true,
                        error: null,
                        data: {
                            ride_id: existingByIdempotency.id,
                            status: existingByIdempotency.status,
                            distance_km: (existingByIdempotency.distance_meters || 0) / 1000,
                            duration_min: (existingByIdempotency.duration_seconds || 0) / 60,
                            total_fare_cents: existingByIdempotency.total_fare_cents,
                            vehicle_type: existingByIdempotency.vehicle_type,
                            payment_method: existingByIdempotency.payment_method,
                            existing_ride: true,
                        },
                    }),
                    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
        }

        if (!pickup_lat || !pickup_lng || !dropoff_lat || !dropoff_lng) {
            log("ERROR", "Missing coordinates", { requestId, rider_id });
            return new Response(
                JSON.stringify({ success: false, error: "Missing coordinates", data: null }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ASYMMETRIC LOCK: Verify pickup only (supply control). Not a wall.
        // Dropoff and stops are 100% open island-wide — passengers go anywhere.
        // If inside active zone: priority mapping, guaranteed driver density.
        // If outside active zone: ride proceeds normally (standard dispatch).
        //   The coordinate is tagged as a Demand Signal (seeded_zone).
        //   This does NOT block the ride — it prioritises Expansion over Exclusion.
        // FAIL CLOSED: If the DB errors, ride proceeds (no stranding).
        // NOTE: query builders are thenables without .catch() — use the
        // two-argument .then(ok, err) form or the call throws at runtime.
        const { data: pickupVerified } = await adminClient
            .rpc('is_verified_location', { p_lat: pickup_lat, p_lng: pickup_lng })
            .then((res) => res, () => ({ data: null }));

        const insideActiveZone = pickupVerified === true;

        if (!insideActiveZone) {
            log("INFO", "Pickup outside active zone — tagging demand signal", { requestId, rider_id, pickup_lat, pickup_lng });
            await adminClient
                .rpc('seed_zone', { p_lat: pickup_lat, p_lng: pickup_lng, p_territory_name: 'Demand Signal' })
                .then((res) => res, (e: unknown) => console.error("seed_zone (demand signal) failed:", e));
        }
        // Dropoff + stops: no verification. Destination utility is open island-wide.

        // Fetch rider level for dispatch priority
        const { data: progression } = await adminClient
            .from("rider_progression")
            .select("level")
            .eq("rider_id", rider_id)
            .maybeSingle()
            .then((res) => res, () => ({ data: null }));
        const riderLevel = progression?.level ?? 0;

        const activeStatuses = ["requested", "searching", "assigned", "arrived", "in_progress"];
        const { data: existingRide } = await supabaseClient
            .from("rides")
            .select("*")
            .eq("rider_id", rider_id)
            .in("status", activeStatuses)
            .maybeSingle();

        if (existingRide) {
            return new Response(
                JSON.stringify({
                    success: true,
                    error: null,
                    data: {
                        ride_id: existingRide.id,
                        status: existingRide.status,
                        distance_km: (existingRide.distance_meters || 0) / 1000,
                        duration_min: (existingRide.duration_seconds || 0) / 60,
                        total_fare_cents: existingRide.total_fare_cents,
                        vehicle_type: existingRide.vehicle_type,
                        payment_method: existingRide.payment_method,
                        existing_ride: true,
                    },
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        let distanceMeters = 5000;
        let durationSeconds = 600;
        let routePolyline = "";
        let routed = false;

        if (MAPBOX_TOKEN) {
            try {
                const mapboxUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${pickup_lng},${pickup_lat};${dropoff_lng},${dropoff_lat}?access_token=${MAPBOX_TOKEN}&geometries=polyline&overview=full`;
                const mapboxResponse = await secureFetch(mapboxUrl);
                const mapboxData = await mapboxResponse.json();

                if (mapboxData.routes && mapboxData.routes.length > 0) {
                    const route = mapboxData.routes[0];
                    distanceMeters = Math.round(route.distance);
                    durationSeconds = Math.round(route.duration);
                    routePolyline = route.geometry || "";
                    routed = true;
                }
            } catch (e) {
                console.error("Mapbox error:", e);
            }
        }

        // No route from Mapbox: price the trip exactly the way estimate_fare
        // does (straight-line distance x 1.3 road factor, ~30 km/h). The old
        // fixed 5 km / 10 min guess meant the rider was quoted one price and
        // booked at another (live 2026-10-15: quoted TT$24.70, booked TT$34.25
        // for a 2.4 km trip).
        if (!routed) {
            const R = 6371000;
            const dLat = (dropoff_lat - pickup_lat) * Math.PI / 180;
            const dLng = (dropoff_lng - pickup_lng) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(pickup_lat * Math.PI / 180) * Math.cos(dropoff_lat * Math.PI / 180) *
                Math.sin(dLng / 2) * Math.sin(dLng / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            distanceMeters = Math.round(R * c * 1.3);
            durationSeconds = Math.round(distanceMeters / 8.33);
        }

        const distanceKm = distanceMeters / 1000;
        const durationMin = durationSeconds / 60;
        const stopsFeeCents = calculateStopsFee(stopList);

        // Admin-controlled vehicle class: canonical key, multiplier, per-class
        // minimum fare. Inactive classes (heavy vehicles pre-launch) are not
        // bookable; unknown keys fall back to the static multiplier table.
        const vehicleClass = await fetchVehicleClass(adminClient, vehicle_type);
        if (vehicleClass && !vehicleClass.is_active) {
            return new Response(
                JSON.stringify({ success: false, error: `${vehicleClass.label} is not available in your area yet.`, data: null }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }
        const vehicleKey = vehicleClass?.key ?? String(vehicle_type).trim().toLowerCase();
        const vehicleLabel = vehicleClass?.label ?? vehicle_type;
        const vehicleMultiplier = vehicleClass ? vehicleClass.multiplier_x100 / 100 : undefined;

        let fareCents = calculateFare(distanceMeters, durationSeconds, vehicle_type, 1.0, stopsFeeCents, vehicleMultiplier);
        if (vehicleClass?.min_fare_cents) {
            fareCents = Math.max(fareCents, vehicleClass.min_fare_cents);
        }

        // Large cash fare: a fresh selfie is required (the app's TT$150 rule).
        const HIGH_VALUE_CASH_CENTS = 15000;
        if (paymentMethod === "cash" && fareCents >= HIGH_VALUE_CASH_CENTS && !hasFreshSelfie) {
            log("ERROR", "High-value cash ride without fresh selfie", { requestId, rider_id, fareCents });
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "Identity verification required. Please complete the selfie check before requesting a ride."
                }),
                { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const { data: balance, error: balanceError } = await supabaseClient
            .rpc("get_wallet_balance", { p_user_id: rider_id });

        if (balanceError) {
            log("ERROR", "Wallet check failed", { error: balanceError });
            throw new Error("Failed to check wallet balance");
        }

        const currentBalance = balance || 0;

        // A cash rider who owes a small amount (in practice: a TT$5 late-cancel
        // fee) can still book. The amount owed is carried onto this ride,
        // collected in cash by the driver, and cleared by settle_cash_ride.
        // Cash riders had no way to clear a debt (wallet top-up is card-only),
        // so the old hard lock meant one late cancel = banned for good.
        // Anything larger, or any non-cash ride, keeps the lock below.
        const MAX_CARRIED_FEE_CENTS = 5000; // TT$50
        let carriedFeeCents = 0;
        if (currentBalance < 0 && paymentMethod === "cash" && -currentBalance <= MAX_CARRIED_FEE_CENTS) {
            carriedFeeCents = -currentBalance;
            log("INFO", "Carrying rider balance onto cash ride", { rider_id, carriedFeeCents });
        } else if (currentBalance < 0) {
            log("INFO", "Rider Debt Lock Triggered", { currentBalance, rider_id });
            return new Response(
                JSON.stringify({
                    success: false,
                    error: `DEBT LOCK: Please clear your outstanding negative balance of ${Math.abs(currentBalance / 100).toFixed(2)} TTD before requesting a new ride.`,
                    data: { balance: currentBalance, locked: true }
                }),
                { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        if (paymentMethod === "wallet" && currentBalance < fareCents) {
            log("INFO", "Insufficient wallet balance", { currentBalance, fareCents });
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "Insufficient wallet balance for this trip.",
                    data: { balance: currentBalance, required: fareCents }
                }),
                { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Canonical 82/15/3 splits enforced by trigger tr_ensure_fare_waterfall.
        // p_driver_payout_cents → rides.driver_payout_cents (overwritten by trigger — pass 0).
        // p_driver_cut / p_platform_cut / p_merchant_cut → revenue_splits (not overwritten).
        const platformFee = Math.round(fareCents * 0.15);
        const driverShareCents = fareCents - platformFee - Math.round(fareCents * 0.03);
        const driverPayoutCents = 0; // trigger overwrites this
        const platformRevenueCents = platformFee;
        const merchantRevenueCents = 0;

        const ridePin = Math.floor(1000 + Math.random() * 9000).toString();

        const metadataWithIdentity: Record<string, unknown> = {
            source,
            source_metadata,
            kiosk_id: kiosk_id || null,
            taxi_stand_id: taxi_stand_id || null,
            guest_name: guest_name || null,
            guest_phone: guest_phone || null,
            band_id: band_id || null,
            carnival_event_id: carnival_event_id || null,
            organizer_id: organizer_id || null,
            event_id: event_id || null,
        };

        const { data: identityPayload, error: identityError } = body.identity_verified
            ? { data: { identity_verified: true, verification_url: body.verification_url }, error: null }
            : { data: null, error: null };

        if (identityPayload) {
            metadataWithIdentity.identity_verified = identityPayload.identity_verified;
            metadataWithIdentity.verification_url = identityPayload.verification_url;
        }

        const flags: Record<string, unknown> = {};
        if (body.flagged_location_drift) {
            flags.flagged_location_drift = true;
        }

        const rideStatus = body.scheduled_for ? "scheduled" : "searching";

        const rpcResult = await adminClient.rpc('create_ride_atomic', {
            p_rider_id: rider_id,
            p_pickup_lat: pickup_lat,
            p_pickup_lng: pickup_lng,
            p_pickup_address: pickup_address,
            p_dropoff_lat: dropoff_lat,
            p_dropoff_lng: dropoff_lng,
            p_dropoff_address: dropoff_address,
            p_status: rideStatus,
            p_total_fare_cents: fareCents,
            p_driver_payout_cents: driverPayoutCents,
            p_distance_meters: distanceMeters,
            p_duration_seconds: durationSeconds,
            p_route_polyline: routePolyline,
            p_vehicle_type: vehicleKey,
            p_payment_method: paymentMethod,
            p_ride_pin: ridePin,
            p_idempotency_key: idempotency_key || null,
            p_metadata: {
                ...metadataWithIdentity,
                ...flags,
                scheduled_for: body.scheduled_for || null,
            },
            p_taxi_stand_id: taxi_stand_id || null,
            p_billed_to_merchant_id: null,
            p_node_id: kiosk_id || null,
            p_driver_cut: driverShareCents,
            p_platform_cut: platformRevenueCents,
            p_merchant_cut: merchantRevenueCents,
        });

        if (!rpcResult.data || !rpcResult.data.success) {
            console.error("Atomic ride creation failed:", rpcResult.error || rpcResult.data?.error);
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "Failed to create ride: " + (rpcResult.data?.error || rpcResult.error || "Unknown error"),
                    data: null
                }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const newRideId = rpcResult.data.ride_id;

        if (carriedFeeCents > 0) {
            const { data: rideMeta } = await adminClient
                .from("rides").select("metadata").eq("id", newRideId).maybeSingle()
                .then((res) => res, () => ({ data: null }));
            const { error: carryErr } = await adminClient
                .from("rides")
                .update({ metadata: { ...(rideMeta?.metadata ?? {}), carried_fee_cents: carriedFeeCents } })
                .eq("id", newRideId);
            if (carryErr) console.error("carried fee tag failed:", carryErr.message);
        }

        // Attach the rider's oldest still-unused claimed promo code (if any)
        // to this ride, so complete_ride can redeem it into the real fare
        // math at settlement. Claiming (PromoScreen) and redeeming
        // (complete_ride) are deliberately separate steps — claiming a code
        // doesn't burn it until a ride it's attached to actually settles,
        // so an abandoned/cancelled ride never wastes the rider's claim.
        // Non-fatal: a promo-attach failure must never block ride creation.
        const { data: unusedClaim } = await adminClient
            .from("user_promos")
            .select("promo_code")
            .eq("user_id", rider_id)
            .eq("is_used", false)
            .order("claimed_at", { ascending: true })
            .limit(1)
            .maybeSingle()
            .then((res) => res, () => ({ data: null }));

        if (unusedClaim?.promo_code) {
            await adminClient
                .from("rides")
                .update({ applied_promo_code: unusedClaim.promo_code })
                .eq("id", newRideId)
                .then((res) => res, (err: unknown) => console.error("promo attach failed (non-fatal):", err));
        }

        // Tag ride with vendor kiosk so complete_ride can record commission —
        // ONLY when the origin is actually verified (a real NFC tap in the
        // last 30 min, or the rider's pickup falls inside the kiosk's
        // geofence). kiosk_id is client-supplied; trusting it blindly would
        // let any request fabricate a node id and redirect real "rent"
        // commission to an arbitrary merchant. An unverified kiosk_id still
        // lets the ride book normally — it just earns the merchant nothing.
        if (kiosk_id && newRideId) {
            const { data: attributionMethod } = await adminClient
                .rpc("verify_kiosk_origin", {
                    p_kiosk_id: kiosk_id,
                    p_rider_id: rider_id,
                    p_pickup_lat: pickup_lat,
                    p_pickup_lng: pickup_lng,
                })
                .then((res) => res, () => ({ data: null }));

            if (attributionMethod) {
                await adminClient
                    .from("rides")
                    .update({ vendor_node_id: kiosk_id, node_attribution_method: attributionMethod })
                    .eq("id", newRideId)
                    .then((res) => res, (err: unknown) => console.error("vendor_node_id tag failed (non-fatal):", err));
            } else {
                log("INFO", "kiosk_id supplied but origin unverified — no node rent attributed", { requestId, rider_id, kiosk_id });
            }

            // Link the NFC order to this ride: find pending order for this rider at the kiosk's merchant.
            // Scoped to rider_id = this rider, so this itself can't attach someone else's order —
            // safe to resolve regardless of rent attribution.
            const { data: nfcKiosk } = await adminClient
                .from("kiosk_nodes")
                .select("merchant_id")
                .eq("id", kiosk_id)
                .single()
                .then((res) => res, () => ({ data: null }));

            if (nfcKiosk?.merchant_id) {
                const { data: nfcOrder } = await adminClient
                    .from("orders")
                    .select("id")
                    .eq("rider_id", rider_id)
                    .eq("merchant_id", nfcKiosk.merchant_id)
                    .eq("status", "pending")
                    .maybeSingle()
                    .then((res) => res, () => ({ data: null }));

                if (nfcOrder?.id) {
                    await adminClient
                        .from("orders")
                        .update({ ride_id: newRideId, total_cents: fareCents })
                        .eq("id", nfcOrder.id)
                        .then((res) => res, (err: unknown) => console.error("NFC order link failed (non-fatal):", err));
                }
            }
        }

        if (stopList.length > 0) {
            const stopsData = stopList.map((s: any, i: number) => ({
                ride_id: newRideId,
                stop_order: i + 1,
                place_name: s.place_name,
                place_address: s.place_address,
                lat: s.lat,
                lng: s.lng,
                stop_type: s.stop_type,
                estimated_wait_minutes: s.estimated_wait_minutes || 10,
                status: 'pending'
            }));

            const { error: stopsError } = await adminClient
                .from("ride_stops")
                .insert(stopsData);

            if (stopsError) {
                console.error("Failed to insert stops (non-fatal):", stopsError);
            }

            await adminClient.from("user_events").insert({
                user_id: rider_id,
                event_type: "stops_added",
                payload: { ride_id: newRideId, count: stopList.length, stops: stopList.map((s: any) => s.stop_type) }
            });
        }

        await adminClient.from("user_events").insert({
            user_id: rider_id,
            event_type: "ride_request",
            payload: {
                ride_id: newRideId,
                vehicle_type: vehicleKey,
                fare_cents: fareCents,
                has_stops: stopList.length > 0
            }
        });

        // ── Enqueue into dispatch_queue ──────────────────────────────────
        try {
            const priority = insideActiveZone ? 100 + (riderLevel ?? 0) * 10 : 0;
            await adminClient.from("dispatch_queue").insert({
                task_type: "RIDE",
                ride_id: newRideId,
                order_id: null,
                pickup_lat,
                pickup_lng,
                priority,
                status: "pending",
                attempts: 0,
                expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            });
        } catch (err) {
            console.error("Failed to enqueue dispatch task (non-fatal):", err);
        }

        // ── Push Notification to Rider ─────────────────────────────────────
        try {
            const { data: riderProfile } = await adminClient
                .from("profiles")
                .select("push_token, notification_enabled")
                .eq("id", rider_id)
                .single();

            if (riderProfile?.push_token && riderProfile?.notification_enabled !== false) {
                sendPushNotification(
                    riderProfile.push_token,
                    '🚖 Ride Requested',
                    `Your ${vehicleLabel} ride to ${dropoff_address} is being searched.`,
                    { type: 'RIDE_CREATED', ride_id: newRideId, status: rideStatus }
                ).catch(err => console.error("Rider push failed:", err));
            }
        } catch (err) {
            console.error("Failed to send ride creation push (non-fatal):", err);
        }

        console.log("Ride created (atomic):", newRideId);

        return new Response(
            JSON.stringify({
                success: true,
                error: null,
                data: {
                    ride_id: newRideId,
                    status: rideStatus,
                    distance_km: parseFloat(distanceKm.toFixed(2)),
                    duration_min: parseFloat(durationMin.toFixed(0)),
                    total_fare_cents: fareCents,
                    vehicle_type: vehicleKey,
                    vehicle_label: vehicleLabel,
                    payment_method: paymentMethod,
                    route_polyline: routePolyline,
                    driver: null,
                    // Owed from an earlier late cancellation, paid in cash with this fare.
                    carried_fee_cents: carriedFeeCents,
                    cash_to_pay_cents: paymentMethod === "cash" ? fareCents + carriedFeeCents : null,
                },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error: any) {
        console.error("create_ride error:", error);
        await captureException(error, { function: 'create_ride' });
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error: " + error.message, data: null }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
