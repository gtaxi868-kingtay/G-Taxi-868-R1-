// Supabase Edge Function: get_active_ride
// Path: supabase/functions/get_active_ride/index.ts
//
// Returns the user's current active ride (if any).
// Used for state restoration on app reload.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

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

        // Query active ride with service role
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        const { data: ride, error: queryError } = await supabase
            .from("rides")
            .select("*")
            .eq("rider_id", userId)
            .in("status", ["requested", "searching", "assigned", "in_progress"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (queryError) {
            console.error("Query error:", queryError);
            return new Response(
                JSON.stringify({ success: false, error: "Failed to get ride", data: null }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // No active ride is a valid state
        if (!ride) {
            return new Response(
                JSON.stringify({ success: true, error: null, data: null }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        return new Response(
            JSON.stringify({
                success: true,
                error: null,
                data: {
                    ride_id: ride.id,
                    status: ride.status,
                    pickup_lat: ride.pickup_lat,
                    pickup_lng: ride.pickup_lng,
                    pickup_address: ride.pickup_address,
                    dropoff_lat: ride.dropoff_lat,
                    dropoff_lng: ride.dropoff_lng,
                    dropoff_address: ride.dropoff_address,
                    total_fare_cents: ride.total_fare_cents,
                    distance_meters: ride.distance_meters,
                    duration_seconds: ride.duration_seconds,
                    created_at: ride.created_at,
                },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("get_active_ride error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error", data: null }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
