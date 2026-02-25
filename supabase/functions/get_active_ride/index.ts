// Supabase Edge Function: get_active_ride
// HARDENED - Secure auth via supabase.auth.getUser()
//
// Gets the user's currently active ride.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        // 1. Initialize Supabase Client with Auth Context (using ANON KEY + user JWT)
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
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

        if (authError || !user) {
            console.error("Auth failed:", authError);
            return new Response(
                JSON.stringify({ success: false, error: "Unauthorized: Valid JWT required" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const userId = user.id;
        console.log("Verifying active ride for user:", userId);

        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // 3. Get active ride
        const activeStatuses = ["requested", "searching", "assigned", "arrived", "in_progress"];
        const { data: ride, error: rideError } = await supabaseAdmin
            .from("rides")
            .select("*")
            .eq("rider_id", userId)
            .in("status", activeStatuses)
            .order("created_at", { ascending: false })
            .maybeSingle();

        if (rideError) {
            console.error("Query error:", rideError);
            return new Response(
                JSON.stringify({ success: false, error: "Failed to fetch ride", data: null }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // No active ride
        if (!ride) {
            return new Response(
                JSON.stringify({ success: true, error: null, data: null }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Get driver info if assigned
        let driver = null;
        if (ride.driver_id) {
            const { data: driverData } = await supabaseAdmin
                .from("drivers")
                .select("id, name, phone_number, vehicle_model, plate_number, rating, current_lat, current_lng")
                .eq("id", ride.driver_id)
                .single();

            if (driverData) {
                driver = {
                    id: driverData.id,
                    name: driverData.name,
                    phone_number: driverData.phone_number,
                    vehicle: driverData.vehicle_model,
                    plate: driverData.plate_number,
                    rating: driverData.rating,
                    location: {
                        lat: driverData.current_lat,
                        lng: driverData.current_lng,
                    },
                };
            }
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
                    vehicle_type: ride.vehicle_type,
                    payment_method: ride.payment_method,
                    payment_status: ride.payment_status,
                    driver,
                    created_at: ride.created_at,
                    updated_at: ride.updated_at, // For TTL check
                },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("Get active ride error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error", data: null }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
