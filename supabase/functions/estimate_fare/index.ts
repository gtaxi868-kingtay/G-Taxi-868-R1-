// Supabase Edge Function: estimate_fare
// Reads base pricing from platform_config table (admin-configurable).
// Falls back to hardcoded values if table is unavailable.
// Auth: required — anon rate-limited.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { secureFetch } from "../_shared/networkUtility.ts";
import { VEHICLE_MULTIPLIERS, calculateStopsFee } from "../_shared/pricing.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const MAPBOX_TOKEN = Deno.env.get("MAPBOX_ACCESS_TOKEN") || "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Hardcoded defaults — overridden at runtime by platform_config rows.
const DEFAULT_PRICING = {
    BASE_FARE_CENTS: 1600,
    PER_KM_CENTS: 175,
    PER_MIN_CENTS: 95,
    MIN_FARE_CENTS: 2200,
};

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing authorization header", data: null }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
        }

        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: authHeader } },
        });
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
        if (authError || !user) {
            return new Response(
                JSON.stringify({ success: false, error: "Invalid or expired token", data: null }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
        }

        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        const rateCheck = await checkRateLimit(adminClient, user.id, "estimate_fare");
        if (!rateCheck.allowed) {
            return new Response(
                JSON.stringify({ success: false, error: rateCheck.error, data: null }),
                { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
        }

        // ── Dynamic pricing from platform_config ─────────────────────────────
        const pricing = { ...DEFAULT_PRICING };
        try {
            const { data: configRows } = await adminClient
                .from("platform_config")
                .select("key, value_cents");
            if (configRows && configRows.length > 0) {
                for (const row of configRows) {
                    if (row.key in pricing) {
                        (pricing as Record<string, number>)[row.key] = row.value_cents;
                    }
                }
            }
        } catch {
            // Non-fatal: use hardcoded defaults
        }

        const {
            pickup_lat,
            pickup_lng,
            dropoff_lat,
            dropoff_lng,
            vehicle_type = "Standard",
            stops,
        } = await req.json();

        if (!pickup_lat || !pickup_lng || !dropoff_lat || !dropoff_lng) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing coordinates", data: null }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
        }

        // ── Distance + duration ───────────────────────────────────────────────
        let distanceMeters = 0;
        let durationSeconds = 0;
        let mapboxSuccess = false;

        if (MAPBOX_TOKEN) {
            try {
                const url =
                    `https://api.mapbox.com/directions/v5/mapbox/driving/${pickup_lng},${pickup_lat};${dropoff_lng},${dropoff_lat}?access_token=${MAPBOX_TOKEN}`;
                const response = await secureFetch(url);
                const data = await response.json();
                if (data.routes && data.routes.length > 0) {
                    distanceMeters = Math.round(data.routes[0].distance);
                    durationSeconds = Math.round(data.routes[0].duration);
                    mapboxSuccess = true;
                }
            } catch {
                // fall through to Haversine
            }
        }

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

        // ── Surge multiplier ─────────────────────────────────────────────────
        let surgeMultiplier = 1.0;

        const { data: matchedZones } = await adminClient
            .rpc("get_surge_multiplier_for_point", { p_lat: pickup_lat, p_lng: pickup_lng })
            .catch(() => ({ data: null }));

        if (matchedZones && typeof matchedZones === "number" && matchedZones > 1.0) {
            surgeMultiplier = matchedZones;
        } else {
            const { data: activeZones } = await adminClient
                .from("pricing_zones")
                .select("multiplier, center_lat, center_lng, radius_meters")
                .eq("is_active", true)
                .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

            if (activeZones && activeZones.length > 0) {
                for (const zone of activeZones) {
                    if (!zone.center_lat || !zone.center_lng) {
                        if (zone.multiplier > surgeMultiplier) surgeMultiplier = Number(zone.multiplier);
                        continue;
                    }
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

        // ── Fare calculation using dynamic pricing ────────────────────────────
        const totalStopsFeeCents = calculateStopsFee(Array.isArray(stops) ? stops : []);
        const distanceKm = distanceMeters / 1000;
        const durationMin = durationSeconds / 60;
        const vehicleMultiplier = VEHICLE_MULTIPLIERS[vehicle_type] || 1.0;

        let fareCents = pricing.BASE_FARE_CENTS +
            Math.round(distanceKm * pricing.PER_KM_CENTS) +
            Math.round(durationMin * pricing.PER_MIN_CENTS);

        fareCents = Math.round(
            (fareCents + totalStopsFeeCents) * vehicleMultiplier * surgeMultiplier,
        );
        fareCents = Math.max(fareCents, pricing.MIN_FARE_CENTS);

        return new Response(
            JSON.stringify({
                success: true,
                error: null,
                data: {
                    estimated_fare_cents: fareCents,
                    distance_meters: distanceMeters,
                    duration_seconds: durationSeconds,
                    vehicle_type,
                    multiplier: vehicleMultiplier,
                    surge_multiplier: surgeMultiplier,
                    pricing_constants: {
                        base_fare_cents: pricing.BASE_FARE_CENTS,
                        per_km_cents: pricing.PER_KM_CENTS,
                        per_min_cents: pricing.PER_MIN_CENTS,
                        min_fare_cents: pricing.MIN_FARE_CENTS,
                    },
                },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    } catch (error) {
        console.error("Estimate fare error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error", data: null }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }
});
