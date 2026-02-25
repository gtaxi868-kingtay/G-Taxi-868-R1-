// Supabase Edge Function: estimate_fare
// REBUILT - Clean implementation (no auth required - read-only estimate)
//
// Returns fare estimate based on coordinates and vehicle type.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const MAPBOX_TOKEN = Deno.env.get("MAPBOX_ACCESS_TOKEN") || "";

// Trinidad pricing (in TTD cents)
const PRICING = {
    BASE_FARE_CENTS: 1500,
    PER_KM_CENTS: 150,
    PER_MIN_CENTS: 120,
    MIN_FARE_CENTS: 2500,
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

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const {
            pickup_lat,
            pickup_lng,
            dropoff_lat,
            dropoff_lng,
            vehicle_type = "Standard"
        } = await req.json();

        if (!pickup_lat || !pickup_lng || !dropoff_lat || !dropoff_lng) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing coordinates", data: null }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        let distanceMeters = 5000;
        let durationSeconds = 600;

        // Try Mapbox for accurate distance
        if (MAPBOX_TOKEN) {
            try {
                const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${pickup_lng},${pickup_lat};${dropoff_lng},${dropoff_lat}?access_token=${MAPBOX_TOKEN}`;
                const response = await fetch(url);
                const data = await response.json();

                if (data.routes && data.routes.length > 0) {
                    distanceMeters = Math.round(data.routes[0].distance);
                    durationSeconds = Math.round(data.routes[0].duration);
                }
            } catch {
                // Use fallback calculation
            }
        }

        // Fallback: Haversine distance
        if (distanceMeters === 5000) {
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

        // Calculate fare
        const distanceKm = distanceMeters / 1000;
        const durationMin = durationSeconds / 60;
        const multiplier = VEHICLE_MULTIPLIERS[vehicle_type] || 1.0;

        let fareCents = PRICING.BASE_FARE_CENTS +
            Math.round(distanceKm * PRICING.PER_KM_CENTS) +
            Math.round(durationMin * PRICING.PER_MIN_CENTS);

        fareCents = Math.round(fareCents * multiplier);
        fareCents = Math.max(fareCents, PRICING.MIN_FARE_CENTS);

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
