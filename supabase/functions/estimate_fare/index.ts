// Supabase Edge Function: estimate_fare
// Path: supabase/functions/estimate_fare/index.ts
// 
// This function calculates ride fare using Mapbox Directions API.
// ALL pricing logic lives here - client NEVER calculates prices.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const MAPBOX_TOKEN = Deno.env.get("MAPBOX_ACCESS_TOKEN")!;

// Trinidad pricing (in TTD cents) - User configured
const PRICING = {
    BASE_FARE_CENTS: 1500,      // $15.00 TTD base
    PER_KM_CENTS: 170,          // $1.70 TTD per km
    PER_MIN_CENTS: 120,         // $1.20 TTD per minute
    MIN_FARE_CENTS: 2500,       // $25.00 TTD minimum
} as const;

interface RequestBody {
    pickup_lat: number;
    pickup_lng: number;
    dropoff_lat: number;
    dropoff_lng: number;
}

interface FareEstimate {
    distance_km: number;
    duration_min: number;
    total_fare_cents: number;
    route_polyline: string;
}

serve(async (req: Request) => {
    // CORS headers
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    };

    // Handle preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const body: RequestBody = await req.json();
        const { pickup_lat, pickup_lng, dropoff_lat, dropoff_lng } = body;

        // Validate input
        if (!pickup_lat || !pickup_lng || !dropoff_lat || !dropoff_lng) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "Missing required coordinates",
                    data: null,
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Check if token exists
        if (!MAPBOX_TOKEN) {
            console.error("MAPBOX_ACCESS_TOKEN is not set!");
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "Server configuration error: Missing Mapbox token",
                    data: null,
                }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Call Mapbox Directions API
        const mapboxUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${pickup_lng},${pickup_lat};${dropoff_lng},${dropoff_lat}?access_token=${MAPBOX_TOKEN}&geometries=polyline&overview=full`;

        console.log("Calling Mapbox with coords:", { pickup_lat, pickup_lng, dropoff_lat, dropoff_lng });

        const mapboxResponse = await fetch(mapboxUrl);
        const mapboxData = await mapboxResponse.json();

        console.log("Mapbox response status:", mapboxResponse.status);
        console.log("Mapbox response code:", mapboxData.code);

        if (!mapboxData.routes || mapboxData.routes.length === 0) {
            console.error("No routes found. Mapbox response:", JSON.stringify(mapboxData));
            return new Response(
                JSON.stringify({
                    success: false,
                    error: mapboxData.message || "No route found between locations",
                    data: null,
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const route = mapboxData.routes[0];
        const distanceMeters = route.distance;
        const durationSeconds = route.duration;
        const routePolyline = route.geometry;

        // Convert to km and minutes
        const distanceKm = distanceMeters / 1000;
        const durationMin = durationSeconds / 60;

        // Calculate fare (SERVER-SIDE ONLY - Uber standard)
        const distanceFare = Math.round(distanceKm * PRICING.PER_KM_CENTS);
        const timeFare = Math.round(durationMin * PRICING.PER_MIN_CENTS);
        let totalFareCents = PRICING.BASE_FARE_CENTS + distanceFare + timeFare;

        // Enforce minimum fare
        totalFareCents = Math.max(totalFareCents, PRICING.MIN_FARE_CENTS);

        const fareEstimate: FareEstimate = {
            distance_km: Math.round(distanceKm * 10) / 10,
            duration_min: Math.round(durationMin),
            total_fare_cents: totalFareCents,
            route_polyline: routePolyline,
        };

        return new Response(
            JSON.stringify({
                success: true,
                error: null,
                data: fareEstimate,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("estimate_fare error:", error);
        return new Response(
            JSON.stringify({
                success: false,
                error: "Internal server error",
                data: null,
            }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
