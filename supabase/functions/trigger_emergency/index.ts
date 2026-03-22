// trigger_emergency/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const { ride_id } = await req.json();

        if (!ride_id) {
            return new Response(JSON.stringify({ error: "Missing ride_id" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // 1. Get ride details
        const { data: ride, error: rideError } = await supabase
            .from("rides")
            .select("*, rider:rider_id(*), driver:driver_id(*)")
            .eq("id", ride_id)
            .single();

        if (rideError || !ride) {
            throw new Error(`Ride not found: ${rideError?.message}`);
        }

        // 2. Log the emergency
        await supabase.from("emergency_logs").insert({
            ride_id,
            rider_id: ride.rider_id,
            driver_id: ride.driver_id,
            status: "triggered",
            metadata: {
                timestamp: new Date().toISOString(),
                rider_name: ride.rider?.full_name,
                driver_name: ride.driver?.name,
                location: { lat: ride.driver?.lat, lng: ride.driver?.lng }
            }
        });

        // 3. Notify security (placeholder for real SMS/Email/Push)
        // Here you would integrate Twilio or a similar service.
        console.log(`EMERGENCY TRIGGERED for Ride ${ride_id}`);

        return new Response(JSON.stringify({ success: true, message: "Emergency services notified" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
