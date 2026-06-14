// Supabase Edge Function: estimate_fare
// Phase 6 Fix 6.2 — Updated fare structure (locked business rules)
//
// Fare structure (TTD):
//   Base fare:     16.00
//   Per kilometre:  1.75
//   Per minute:     0.95
//   Minimum fare:  22.00
//
// Auth: Not required — read-only fare estimate, no personal data written.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { secureFetch } from "../_shared/networkUtility.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const MAPBOX_TOKEN = Deno.env.get("MAPBOX_ACCESS_TOKEN") || "";

import { PRICING, VEHICLE_MULTIPLIERS, calculateFare, calculateStopsFee } from "../_shared/pricing.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(JSON.stringify({ success: false, error: "Missing authorization header", data: null }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
        if (authError || !user) {
            return new Response(JSON.stringify({ success: false, error: "Invalid or expired token", data: null }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const rateCheck = await checkRateLimit(adminClient, user.id, "estimate_fare");
        if (!rateCheck.allowed) {
            return new Response(JSON.stringify({ success: false, error: rateCheck.error, data: null }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const {
            pickup_lat,
            pickup_lng,
            dropoff_lat,
            dropoff_lng,
            vehicle_type = "Standard",
            stops
        } = await req.json();

        if (!pickup_lat || !pickup_lng || !dropoff_lat || !dropoff_lng) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing coordinates", data: null }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        let distanceMeters = 0;
        let durationSeconds = 0;
        let mapboxSuccess = false;

        // Try Mapbox for accurate distance
        if (MAPBOX_TOKEN) {
            try {
                const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${pickup_lng},${pickup_lat};${dropoff_lng},${dropoff_lat}?access_token=${MAPBOX_TOKEN}`;
                const response = await secureFetch(url);
                const data = await response.json();

                if (data.routes && data.routes.length > 0) {
                    distanceMeters = Math.round(data.routes[0].distance);
                    durationSeconds = Math.round(data.routes[0].duration);
                    mapboxSuccess = true;
                }
            } catch {
                // Use fallback calculation
            }
        }

        // Fallback: Haversine distance (with 1.3x road factor)
        if (!mapboxSuccess) {
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

        // --- SURGE PRICING LOGIC (PostGIS point-in-zone check) ---
        let surgeMultiplier = 1.0;
        // Use PostGIS ST_DWithin to find zones where pickup point is within zone radius.
        // pricing_zones.center_lat/center_lng + radius_meters stored alongside boundary_geojson.
        const { data: matchedZones } = await adminClient
            .rpc("get_surge_multiplier_for_point", {
                p_lat: pickup_lat,
                p_lng: pickup_lng,
            })
            .catch(() => ({ data: null }));

        if (matchedZones && typeof matchedZones === "number" && matchedZones > 1.0) {
            surgeMultiplier = matchedZones;
        } else {
            // Fallback: if RPC not deployed yet, check active zones with bounding box
            const { data: activeZones } = await adminClient
                .from("pricing_zones")
                .select("multiplier, center_lat, center_lng, radius_meters")
                .eq("is_active", true)
                .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

            if (activeZones && activeZones.length > 0) {
                for (const zone of activeZones) {
                    if (!zone.center_lat || !zone.center_lng) {
                        // Legacy zone without center — apply globally (backwards compat)
                        if (zone.multiplier > surgeMultiplier) surgeMultiplier = Number(zone.multiplier);
                        continue;
                    }
                    // Haversine distance check against zone center
                    const R = 6371000;
                    const dLat = (pickup_lat - zone.center_lat) * Math.PI / 180;
                    const dLng = (pickup_lng - zone.center_lng) * Math.PI / 180;
                    const a = Math.sin(dLat / 2) ** 2 +
                        Math.cos(pickup_lat * Math.PI / 180) * Math.cos(zone.center_lat * Math.PI / 180) *
                        Math.sin(dLng / 2) ** 2;
                    const distMeters = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                    const radius = zone.radius_meters ?? 2000;
                    if (distMeters <= radius && zone.multiplier > surgeMultiplier) {
                        surgeMultiplier = Number(zone.multiplier);
                    }
                }
            }
        }

        // Load live pricing from admin-controlled pricing_config table.
        // Falls back to hardcoded PRICING constants if the table is empty or unavailable.
        const { data: configRows } = await adminClient
            .from("pricing_config")
            .select("key, value_cents")
            .catch(() => ({ data: null }));

        const cfg: Record<string, number> = {};
        if (configRows) {
            for (const row of configRows as Array<{ key: string; value_cents: number }>) {
                cfg[row.key] = row.value_cents;
            }
        }
        const liveBaseFare  = cfg["BASE_FARE_CENTS"] ?? PRICING.BASE_FARE_CENTS;
        const livePerKm     = cfg["PER_KM_CENTS"]    ?? PRICING.PER_KM_CENTS;
        const livePerMin    = cfg["PER_MIN_CENTS"]    ?? PRICING.PER_MIN_CENTS;
        const liveMinFare   = cfg["MIN_FARE_CENTS"]   ?? PRICING.MIN_FARE_CENTS;

        const totalStopsFeeCents = calculateStopsFee(Array.isArray(stops) ? stops : []);

        const multiplier = VEHICLE_MULTIPLIERS[vehicle_type] || 1.0;
        const distanceKm = distanceMeters / 1000;
        const durationMin = durationSeconds / 60;
        let rawFare = liveBaseFare +
            Math.round(distanceKm * livePerKm) +
            Math.round(durationMin * livePerMin);
        rawFare = Math.round((rawFare + totalStopsFeeCents) * multiplier * surgeMultiplier);
        const fareCents = Math.max(rawFare, liveMinFare);

        return new Response(
            JSON.stringify({
                success: true,
                error: null,
                data: {
                    estimated_fare_cents: fareCents,
                    distance_meters: distanceMeters,
                    duration_seconds: durationSeconds,
                    vehicle_type,
                    multiplier,
                    surge_multiplier: surgeMultiplier,
                    pricing_constants: {
                        base_fare_cents: liveBaseFare,
                        per_km_cents: livePerKm,
                        per_min_cents: livePerMin,
                        min_fare_cents: liveMinFare,
                        stop_base_grocery_cents: PRICING.STOP_BASE_GROCERY_CENTS,
                        stop_base_pharmacy_cents: PRICING.STOP_BASE_PHARMACY_CENTS,
                        stop_base_other_cents: PRICING.STOP_BASE_OTHER_CENTS,
                        wait_fee_per_minute_cents: livePerMin,
                    },
                },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("Estimate fare error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error", data: null }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
