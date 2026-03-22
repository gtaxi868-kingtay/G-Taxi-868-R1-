// auto-match-bot/index.ts
// Edge Function that automatically matches ride requests to bot drivers

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RideRequest {
    ride_id: string;
    pickup_lat: number;
    pickup_lng: number;
    vehicle_type?: string;
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const { ride_id, pickup_lat, pickup_lng, vehicle_type = "standard" }: RideRequest = await req.json();

        if (!ride_id || !pickup_lat || !pickup_lng) {
            return new Response(
                JSON.stringify({ error: "Missing required fields: ride_id, pickup_lat, pickup_lng" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 1. Find an available bot driver near the pickup location
        const { data: botDrivers, error: driverError } = await supabase
            .from("drivers")
            .select("id, name, lat, lng, vehicle_type, vehicle_model, plate_number, rating")
            .eq("is_bot", true)
            .eq("is_online", true)
            .eq("status", "online")
            .limit(5);

        if (driverError || !botDrivers || botDrivers.length === 0) {
            return new Response(
                JSON.stringify({ error: "No available bot drivers", details: driverError }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 2. Pick the closest bot driver
        const pickClosest = (drivers: any[]) => {
            return drivers.reduce((closest, driver) => {
                const dist = Math.sqrt(
                    Math.pow(driver.lat - pickup_lat, 2) + Math.pow(driver.lng - pickup_lng, 2)
                );
                if (!closest || dist < closest.dist) {
                    return { ...driver, dist };
                }
                return closest;
            }, null);
        };

        const selectedDriver = pickClosest(botDrivers);

        // 3. Assign the driver to the ride
        const { error: updateError } = await supabase
            .from("rides")
            .update({
                driver_id: selectedDriver.id,
                status: "assigned",
                updated_at: new Date().toISOString(),
            })
            .eq("id", ride_id)
            .in("status", ["requested", "searching", "waiting_queue"]);

        if (updateError) {
            return new Response(
                JSON.stringify({ error: "Failed to assign driver", details: updateError }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 4. Mark driver as busy
        await supabase
            .from("drivers")
            .update({ status: "busy" })
            .eq("id", selectedDriver.id);

        // 5. Start movement simulation (move driver toward pickup)
        // This will be done in a separate interval or cron job
        // For now, we just assign and return the driver info

        return new Response(
            JSON.stringify({
                success: true,
                driver: {
                    id: selectedDriver.id,
                    name: selectedDriver.name,
                    vehicle_model: selectedDriver.vehicle_model,
                    plate_number: selectedDriver.plate_number,
                    rating: selectedDriver.rating,
                    lat: selectedDriver.lat,
                    lng: selectedDriver.lng,
                },
                message: `Bot driver ${selectedDriver.name} assigned to ride`,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (err) {
        return new Response(
            JSON.stringify({ error: "Internal server error", details: String(err) }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
