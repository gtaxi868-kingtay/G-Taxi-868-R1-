import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function requireAuth(req: Request) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
        throw new Response(JSON.stringify({ error: "Missing authorization header" }), {
            status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }
    const supabaseClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!
    );
    const { data: { user }, error } = await supabaseClient.auth.getUser(
        authHeader.replace("Bearer ", "")
    );
    if (error || !user) {
        throw new Response(JSON.stringify({ error: "Invalid or expired token" }), {
            status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }
    return user;
}

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const user = await requireAuth(req);

        const supabaseAdmin = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        const body = await req.json();
        const { ride_id } = body;

        let pickupLat: number, pickupLng: number, dropoffLat: number, dropoffLng: number;

        if (ride_id) {
            const { data: ride, error } = await supabaseAdmin
                .from("rides")
                .select("rider_id, driver_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng")
                .eq("id", ride_id)
                .single();

            if (error || !ride) {
                return new Response(
                    JSON.stringify({ success: false, error: "Ride not found" }),
                    { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            let isAuthorized = ride.rider_id === user.id;
            if (!isAuthorized && ride.driver_id) {
                const { data: callerDriver } = await supabaseAdmin
                    .from("drivers")
                    .select("id")
                    .eq("user_id", user.id)
                    .maybeSingle();
                isAuthorized = !!callerDriver && callerDriver.id === ride.driver_id;
            }
            if (!isAuthorized) {
                return new Response(
                    JSON.stringify({ success: false, error: "Forbidden" }),
                    { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            pickupLat = ride.pickup_lat;
            pickupLng = ride.pickup_lng;
            dropoffLat = ride.dropoff_lat;
            dropoffLng = ride.dropoff_lng;
        } else {
            pickupLat = body.pickup_lat;
            pickupLng = body.pickup_lng;
            dropoffLat = body.dropoff_lat || pickupLat;
            dropoffLng = body.dropoff_lng || pickupLng;
        }

        if (!pickupLat || !pickupLng) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing coordinates" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const { data: merchants, error: mErr } = await supabaseAdmin
            .rpc("get_nearby_merchants_for_route", {
                p_pickup_lat: pickupLat,
                p_pickup_lng: pickupLng,
                p_dropoff_lat: dropoffLat || pickupLat,
                p_dropoff_lng: dropoffLng || pickupLng,
                p_radius_km: 5,
            });

        if (mErr) {
            console.error("get_nearby_merchants_for_route RPC error:", mErr);
            return new Response(
                JSON.stringify({ success: false, error: "Failed to fetch merchants" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        return new Response(
            JSON.stringify({ success: true, data: { merchants: merchants || [] } }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error("get_nearby_merchants error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
