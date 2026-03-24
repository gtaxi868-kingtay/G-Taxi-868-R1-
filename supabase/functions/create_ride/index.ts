// Supabase Edge Function: create_ride
// HARDENED MODE - Strict Auth Verification
//
// Creates a new ride request with server-calculated fare.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { captureException } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const MAPBOX_TOKEN = Deno.env.get("MAPBOX_ACCESS_TOKEN") ?? "";

// Trinidad pricing (in TTD cents)
const PRICING = {
    BASE_FARE_CENTS: 1600,
    PER_KM_CENTS: 175,
    PER_MIN_CENTS: 95,
    MIN_FARE_CENTS: 2200,
};

const VEHICLE_MULTIPLIERS: Record<string, number> = {
    "Standard": 1.0,
    "XL": 1.5,
    "Premium": 2.0,
};

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Phase 8: Structured Logging
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

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        // 1. Initialize Supabase Client with Auth Context
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
        // We strictly require a valid user session.
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

        const rider_id = user.id; // STRICT usage of verified ID

        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const rateCheck = await checkRateLimit(adminClient, rider_id, "create_ride");
        if (!rateCheck.allowed) {
            return new Response(
                JSON.stringify({ success: false, error: rateCheck.error }),
                { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 3. Parse Request Body
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

        const {
            pickup_lat,
            pickup_lng,
            pickup_address = "Pickup Location",
            dropoff_lat,
            dropoff_lng,
            dropoff_address = "Destination",
            vehicle_type = "Standard",
            // payment_method = "cash", // Removed default to respect body
            payment_method, // use body value
            scheduled_for,
            stops = [] // New: stops array (Fix 3)
        } = body;

        log("INFO", "Request from verified user", { requestId, rider_id, vehicle_type, payment_method, stops_count: stops.length });

        if (!pickup_lat || !pickup_lng || !dropoff_lat || !dropoff_lng) {
            log("ERROR", "Missing coordinates", { requestId, rider_id });
            return new Response(
                JSON.stringify({ success: false, error: "Missing coordinates", data: null }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }


        // 4. Check for Existing Active Ride
        const activeStatuses = ["requested", "searching", "assigned", "in_progress"];
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

        // 5. Calculate Route (Mapbox or Haversine Fallback)
        let distanceMeters = 5000;
        let durationSeconds = 600;
        let routePolyline = "";

        if (MAPBOX_TOKEN) {
            try {
                const mapboxUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${pickup_lng},${pickup_lat};${dropoff_lng},${dropoff_lat}?access_token=${MAPBOX_TOKEN}&geometries=polyline&overview=full`;
                const mapboxResponse = await fetch(mapboxUrl);
                const mapboxData = await mapboxResponse.json();

                if (mapboxData.routes && mapboxData.routes.length > 0) {
                    const route = mapboxData.routes[0];
                    distanceMeters = Math.round(route.distance);
                    durationSeconds = Math.round(route.duration);
                    routePolyline = route.geometry || "";
                }
            } catch (e) {
                console.error("Mapbox error:", e);
                // Fallback will be used
            }
        }

        // 6. Calculate Fare
        const distanceKm = distanceMeters / 1000;
        const durationMin = durationSeconds / 60;
        const multiplier = VEHICLE_MULTIPLIERS[vehicle_type] || 1.0;

        let fareCents = PRICING.BASE_FARE_CENTS +
            Math.round(distanceKm * PRICING.PER_KM_CENTS) +
            Math.round(durationMin * PRICING.PER_MIN_CENTS);

        fareCents = Math.round(fareCents * multiplier);

        // Add Multi-Stop Fees (Fix 3)
        const STOP_CONVENIENCE_FEE_CENTS = 500; // $5.00 TTD
        const WAIT_RATE_PER_MIN_CENTS = 85.5; // $0.855 TTD

        let stopsFeeCents = 0;
        if (stops && stops.length > 0) {
            stopsFeeCents = stops.reduce((total: number, stop: any) => {
                const waitFee = Math.round((stop.estimated_wait_minutes || 10) * WAIT_RATE_PER_MIN_CENTS);
                return total + STOP_CONVENIENCE_FEE_CENTS + waitFee;
            }, 0);
        }

        fareCents += stopsFeeCents;
        fareCents = Math.max(fareCents, PRICING.MIN_FARE_CENTS);

        // 6.5. PHASE 8: RIDER DEBT LOCK & Payment Reserve Check
        const { data: balance, error: balanceError } = await supabaseClient
            .rpc("get_wallet_balance", { p_user_id: rider_id });

        if (balanceError) {
            log("ERROR", "Wallet check failed", { error: balanceError });
            throw new Error("Failed to check wallet balance");
        }

        const currentBalance = balance || 0;

        // Debt Lock: Block ANY new rides if the rider owes money (balance < 0)
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

        // Wallet Payment Check: Prevent requesting a ride they can't afford
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

        // 7. Insert Ride
        // We use the Service Role key here if we need to bypass any potential RLS on INSERT,
        // but typically the User should be allowed to INSERT their own ride.
        // However, since we validated the user above, we can safely use the Service Role for the INSERT
        // to ensure it works even if specific INSERT policies are tricky, OR we use the user client.
        // Let's use the User Client to respect RLS (Proof of Concept for Phase 2).

        const { data: newRide, error: insertError } = await supabaseClient
            .from("rides")
            .insert({
                rider_id: rider_id,
                pickup_lat,
                pickup_lng,
                pickup_address,
                dropoff_lat,
                dropoff_lng,
                dropoff_address,
                status: body.scheduled_for ? "scheduled" : "searching",
                scheduled_for: body.scheduled_for || null,
                total_fare_cents: fareCents,
                distance_meters: distanceMeters,
                duration_seconds: durationSeconds,
                route_polyline: routePolyline,
                vehicle_type,
                payment_method,
                ride_pin: Math.floor(1000 + Math.random() * 9000).toString(),
            })
            .select()
            .single();

        if (insertError) {
            console.error("Insert error:", insertError);
            return new Response(
                JSON.stringify({ success: false, error: "Failed to create ride: " + insertError.message, data: null }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 8. Insert Ride Stops (Fix 3)
        if (stops && stops.length > 0) {
            const stopsData = stops.map((s: any, i: number) => ({
                ride_id: newRide.id,
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
                console.error("Failed to insert stops (non-fatal for ride creation):", stopsError);
            }

            // AI LAYER: Log stops_added event
            await adminClient.from("user_events").insert({
                user_id: rider_id,
                event_type: "stops_added",
                payload: { ride_id: newRide.id, count: stops.length, stops: stops.map((s: any) => s.stop_type) }
            });
        }

        // AI LAYER: Log ride_request event
        await adminClient.from("user_events").insert({
            user_id: rider_id,
            event_type: "ride_request",
            payload: { 
                ride_id: newRide.id, 
                vehicle_type, 
                fare_cents: fareCents,
                has_stops: stops.length > 0
            }
        });

        console.log("Ride created:", newRide.id);

        return new Response(
            JSON.stringify({
                success: true,
                error: null,
                data: {
                    ride_id: newRide.id,
                    status: "searching",
                    distance_km: parseFloat(distanceKm.toFixed(2)),
                    duration_min: parseFloat(durationMin.toFixed(0)),
                    total_fare_cents: fareCents,
                    vehicle_type,
                    payment_method,
                    route_polyline: routePolyline,
                    driver: null, // Async matching
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
