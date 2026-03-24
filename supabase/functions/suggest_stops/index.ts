// Supabase Edge Function: suggest_stops
// Provides AI-driven or location-based stop suggestions for a rider's trip.
// For Phase 1, it returns a hardcoded list of common convenience stops.
// Future phases will integrate Mapbox POI search and user history.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { captureException } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: {
                headers: { Authorization: req.headers.get("Authorization")! },
            },
        });

        const {
            data: { user },
            error: authError,
        } = await supabaseClient.auth.getUser();

        if (authError || !user) {
            return new Response(
                JSON.stringify({ success: false, error: "Unauthorized" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Parse request
        const body = await req.json().catch(() => ({}));
        const { pickup_lat, pickup_lng, dropoff_lat, dropoff_lng } = body;

        // Verify coordinates exist
        if (!pickup_lat || !pickup_lng) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing coordinates" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // PHASE 1 FALLBACK: Return standard convenient stops
        // In Phase 2: Query Mapbox POI API along the route polyline
        const suggestions = [
            {
                place_name: "Massy Stores Supermarket",
                place_address: "Convenience stop",
                lat: pickup_lat + 0.001, // Mock location near pickup
                lng: pickup_lng + 0.001,
                stop_type: "grocery",
                estimated_wait_minutes: 15
            },
            {
                place_name: "ATM / Bank",
                place_address: "Quick cash withdrawal",
                lat: pickup_lat - 0.001, // Mock location near pickup
                lng: pickup_lng - 0.001,
                stop_type: "errand",
                estimated_wait_minutes: 5
            },
            {
                place_name: "Pharmacy",
                place_address: "Quick prescription pickup",
                lat: pickup_lat + 0.002,
                lng: pickup_lng - 0.002,
                stop_type: "errand",
                estimated_wait_minutes: 10
            }
        ];

        return new Response(
            JSON.stringify({
                success: true,
                data: { suggestions }
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error: any) {
        console.error("suggest_stops error:", error);
        await captureException(error, { function: 'suggest_stops' });
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error: " + error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
