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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const MAPBOX_TOKEN = Deno.env.get("MAPBOX_ACCESS_TOKEN") || "";

// --- Locked fare structure (TTD cents) ---
// Base fare:     $16.00 TTD = 1600 cents
// Per kilometre:  $1.75 TTD =  175 cents
// Per minute:     $0.95 TTD =   95 cents
// Minimum fare:  $22.00 TTD = 2200 cents
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

        // Fallback: Haversine distance (with 1.3x road factor)
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
