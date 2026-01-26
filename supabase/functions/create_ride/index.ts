// Supabase Edge Function: create_ride
// Path: supabase/functions/create_ride/index.ts
//
// Creates a new ride request with server-calculated fare.
// Enforces one active ride per rider via database constraint.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAPBOX_TOKEN = Deno.env.get("MAPBOX_ACCESS_TOKEN")!;

// Trinidad pricing (in TTD cents) - Same as estimate_fare
const PRICING = {
    BASE_FARE_CENTS: 1500,      // $15.00 TTD base
    PER_KM_CENTS: 170,          // $1.70 TTD per km
    PER_MIN_CENTS: 120,         // $1.20 TTD per minute
    MIN_FARE_CENTS: 2500,       // $25.00 TTD minimum
} as const;

// Extract user ID from JWT payload (base64 decode)
function getUserIdFromJWT(token: string): string | null {
    try {
        const parts = token.replace("Bearer ", "").split(".");
        if (parts.length !== 3) return null;
        const payload = JSON.parse(atob(parts[1]));
        return payload.sub || null;
    } catch {
        return null;
    }
}

interface RequestBody {
    pickup_lat: number;
    pickup_lng: number;
    pickup_address?: string;
    dropoff_lat: number;
    dropoff_lng: number;
    dropoff_address?: string;
}

serve(async (req: Request) => {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    };

    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        // Get user from JWT
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing authorization", data: null }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Extract user ID directly from JWT (Supabase signs these)
        const userId = getUserIdFromJWT(authHeader);
        if (!userId) {
            return new Response(
                JSON.stringify({ success: false, error: "Invalid token format", data: null }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Create Supabase client with service role for database operations
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        const body: RequestBody = await req.json();
        const { pickup_lat, pickup_lng, pickup_address, dropoff_lat, dropoff_lng, dropoff_address } = body;

        // Validate input
        if (!pickup_lat || !pickup_lng || !dropoff_lat || !dropoff_lng) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing required coordinates", data: null }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // UBER PATTERN: Check for existing active ride first
        const activeStatuses = ["requested", "searching", "assigned", "in_progress"];
        const { data: existingRide } = await supabase
            .from("rides")
            .select("*")
            .eq("rider_id", userId)
            .in("status", activeStatuses)
            .single();

        // If active ride exists, return it instead of failing
        if (existingRide) {
            return new Response(
                JSON.stringify({
                    success: true,
                    error: null,
                    data: {
                        ride_id: existingRide.id,
                        status: existingRide.status,
                        distance_km: existingRide.distance_meters / 1000,
                        duration_min: existingRide.duration_seconds / 60,
                        total_fare_cents: existingRide.total_fare_cents,
                        existing_ride: true, // Flag to indicate this is an existing ride
                    },
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Call Mapbox for route calculation (server-side only)
        const mapboxUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${pickup_lng},${pickup_lat};${dropoff_lng},${dropoff_lat}?access_token=${MAPBOX_TOKEN}&geometries=polyline&overview=full`;

        const mapboxResponse = await fetch(mapboxUrl);
        const mapboxData = await mapboxResponse.json();

        if (!mapboxData.routes || mapboxData.routes.length === 0) {
            return new Response(
                JSON.stringify({ success: false, error: "No route found", data: null }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const route = mapboxData.routes[0];
        const distanceMeters = Math.round(route.distance);
        const durationSeconds = Math.round(route.duration);
        const routePolyline = route.geometry;

        // Calculate fare (SERVER-SIDE ONLY)
        const distanceKm = distanceMeters / 1000;
        const durationMin = durationSeconds / 60;
        const distanceFare = Math.round(distanceKm * PRICING.PER_KM_CENTS);
        const timeFare = Math.round(durationMin * PRICING.PER_MIN_CENTS);
        let totalFareCents = PRICING.BASE_FARE_CENTS + distanceFare + timeFare;
        totalFareCents = Math.max(totalFareCents, PRICING.MIN_FARE_CENTS);

        // Insert ride (DB constraint prevents duplicates - Uber pattern)
        const { data: ride, error: insertError } = await supabase
            .from("rides")
            .insert({
                rider_id: userId,
                pickup_lat,
                pickup_lng,
                pickup_address: pickup_address || null,
                dropoff_lat,
                dropoff_lng,
                dropoff_address: dropoff_address || null,
                status: "requested",
                total_fare_cents: totalFareCents,
                distance_meters: distanceMeters,
                duration_seconds: durationSeconds,
                route_polyline: routePolyline,
            })
            .select()
            .single();

        if (insertError) {
            // Check if it's a duplicate ride error (unique constraint violation)
            if (insertError.code === "23505") {
                return new Response(
                    JSON.stringify({
                        success: false,
                        error: "You already have an active ride",
                        data: null
                    }),
                    { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            console.error("Insert error:", insertError);
            return new Response(
                JSON.stringify({ success: false, error: "Failed to create ride", data: null }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        return new Response(
            JSON.stringify({
                success: true,
                error: null,
                data: {
                    ride_id: ride.id,
                    status: ride.status,
                    distance_km: Math.round(distanceKm * 10) / 10,
                    duration_min: Math.round(durationMin),
                    total_fare_cents: totalFareCents,
                },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("create_ride error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error", data: null }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
