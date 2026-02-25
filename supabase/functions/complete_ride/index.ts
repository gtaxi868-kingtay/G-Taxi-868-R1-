// Supabase Edge Function: complete_ride
// REBUILT - Clean implementation with proper Supabase auth + GPS Truth Enforcement

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// --- Haversine Distance Helper ---
function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180; // φ, λ in radians
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // in metres
}

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing authorization", data: null }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: authHeader } }
        });

        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

        if (authError || !user) {
            return new Response(
                JSON.stringify({ success: false, error: "Invalid token", data: null }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const userId = user.id;

        // PARSE INPUT WITH GPS TRUTH
        const { ride_id, driver_lat, driver_lng } = await req.json();
        if (!ride_id) {
            return new Response(
                JSON.stringify({ success: false, error: "ride_id required", data: null }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        const { data: ride, error: rideError } = await supabaseAdmin
            .from("rides")
            .select("*")
            .eq("id", ride_id)
            .single();

        if (rideError || !ride) {
            return new Response(
                JSON.stringify({ success: false, error: "Ride not found", data: null }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const isRider = ride.rider_id === userId;
        const isDriver = ride.driver_id === userId;

        if (!isRider && !isDriver) {
            return new Response(
                JSON.stringify({ success: false, error: "Not authorized", data: null }),
                { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // --- GPS TRUTH ENFORCEMENT ---
        // Only enforce if the driver is making the request. 
        if (isDriver) {
            if (!driver_lat || !driver_lng) {
                return new Response(
                    JSON.stringify({ success: false, error: "GPS coordinates required to complete ride", data: null }),
                    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            const distMeters = getDistanceMeters(
                driver_lat, driver_lng,
                ride.dropoff_lat, ride.dropoff_lng
            );

            if (distMeters > 150) {
                return new Response(
                    JSON.stringify({
                        success: false,
                        error: `Too far from dropoff. You are ${Math.round(distMeters)}m away (max 150m).`,
                        data: { distance: distMeters }
                    }),
                    { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
        }

        // PAYMENT CAPTURE & COMMISSION
        if (ride.payment_method === "wallet" && ride.payment_status !== "captured") {
            const { data: success, error: payError } = await supabaseAdmin
                .rpc("process_wallet_payment", {
                    p_ride_id: ride_id,
                    p_amount: ride.total_fare_cents
                });

            if (payError || !success) {
                console.error("Payment failed:", payError);
                return new Response(
                    JSON.stringify({
                        success: false,
                        error: "Payment failed: Insufficient wallet funds",
                        data: { required: ride.total_fare_cents }
                    }),
                    { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
        } else if (ride.payment_method === "cash") {
            // 15% Platform Commission on Cash rides
            const commission = Math.round(ride.total_fare_cents * 0.15);
            const { error: commError } = await supabaseAdmin
                .from("wallet_transactions")
                .insert({
                    user_id: ride.driver_id,
                    ride_id: ride_id,
                    amount: -commission,
                    transaction_type: "commission_fee",
                    description: "Platform commission (15%) for cash ride",
                    status: "completed"
                });

            if (commError) {
                console.error("Failed to deduct cash commission:", commError);
            }
        }

        // ATOMIC RECORD UPDATE
        const { error: updateError, count } = await supabaseAdmin
            .from("rides")
            .update({
                status: "completed",
                completed_at: new Date().toISOString(),
            })
            .eq("id", ride_id)
            .in("status", ["assigned", "arrived", "in_progress"]);

        if (updateError || count === 0) {
            return new Response(
                JSON.stringify({ success: false, error: "Failed to complete ride: status changed or already completed", data: null }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        return new Response(
            JSON.stringify({
                success: true,
                error: null,
                data: { ride_id, status: "completed", total_fare_cents: ride.total_fare_cents },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("Complete ride error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error", data: null }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
