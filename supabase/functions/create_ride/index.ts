import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { calculateFare, calculateStopsFee, fetchVehicleClass } from "../_shared/pricing.ts";
import { captureException } from "../_shared/sentry.ts";
import { sendPushNotification } from "../_shared/push.ts";
import { secureFetch } from "../_shared/networkUtility.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAPBOX_TOKEN = Deno.env.get("MAPBOX_ACCESS_TOKEN") ?? "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

        if (!body.identity_verified) {
            log("ERROR", "Missing identity verification", { requestId, rider_id });
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "Identity verification required. Please complete the selfie check before requesting a ride."
                }),
                { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
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

        log("INFO", "Request from verified user", { requestId, rider_id, vehicle_type, payment_method, idempotency_key });

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
                }
            } catch (e) {
                console.error("Mapbox error:", e);
            }
        }

        const distanceKm = distanceMeters / 1000;
        const durationMin = durationSeconds / 60;
        const stopsFeeCents = calculateStopsFee(Array.isArray(stops) ? stops : []);

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

        const { data: balance, error: balanceError } = await supabaseClient
            .rpc("get_wallet_balance", { p_user_id: rider_id });

        if (balanceError) {
            log("ERROR", "Wallet check failed", { error: balanceError });
            throw new Error("Failed to check wallet balance");
        }

        const currentBalance = balance || 0;

        if (currentBalance < 0) {
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

        if (payment_method === "wallet" && currentBalance < fareCents) {
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
            p_payment_method: payment_method || "cash",
            p_ride_pin: ridePin,
            p_idempotency_key: idempotency_key || null,
            p_metadata: {
                ...metadataWithIdentity,
                ...flags,
                scheduled_for: body.scheduled_for || null,
            },
            p_taxi_stand_id: taxi_stand_id || null,
            p_billed_to_merchant_id: billed_to_merchant_id || null,
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

        // Tag ride with vendor kiosk so complete_ride can record commission
        if (kiosk_id && newRideId) {
            await adminClient
                .from("rides")
                .update({ vendor_node_id: kiosk_id })
                .eq("id", newRideId)
                .then((res) => res, (err: unknown) => console.error("vendor_node_id tag failed (non-fatal):", err));

            // Link the NFC order to this ride: find pending order for this rider at the kiosk's merchant
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

        if (stops && stops.length > 0) {
            const stopsData = stops.map((s: any, i: number) => ({
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
                payload: { ride_id: newRideId, count: stops.length, stops: stops.map((s: any) => s.stop_type) }
            });
        }

        await adminClient.from("user_events").insert({
            user_id: rider_id,
            event_type: "ride_request",
            payload: {
                ride_id: newRideId,
                vehicle_type: vehicleKey,
                fare_cents: fareCents,
                has_stops: stops.length > 0
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
                    payment_method,
                    route_polyline: routePolyline,
                    driver: null,
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
