// Supabase Edge Function: cancel_ride
// REBUILT - Clean implementation with proper Supabase auth
//
// Cancels a ride request. Only the rider can cancel.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        // 1. AUTHENTICATION
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

        // 2. PARSE INPUT
        const { ride_id, reason } = await req.json();
        if (!ride_id) {
            return new Response(
                JSON.stringify({ success: false, error: "ride_id required", data: null }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // 3. GET RIDE AND VERIFY OWNERSHIP
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

        // Security: Allow rider OR assigned driver to cancel
        const isRider = ride.rider_id === userId;

        let isDriver = false;
        if (ride.driver_id) {
            // Need to get the driver's user_id from the drivers table
            const { data: driverData } = await supabaseAdmin
                .from("drivers")
                .select("user_id")
                .eq("id", ride.driver_id)
                .single();

            isDriver = driverData?.user_id === userId;
        }

        if (!isRider && !isDriver) {
            return new Response(
                JSON.stringify({ success: false, error: "Not authorized to cancel this ride", data: null }),
                { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Check if ride can be cancelled
        const cancellableStatuses = ["requested", "searching", "assigned", "arrived"];

        if (!cancellableStatuses.includes(ride.status)) {
            return new Response(
                JSON.stringify({ success: false, error: "Ride cannot be cancelled", data: null }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const updatePayload: any = {
            status: "cancelled",
            cancelled_at: new Date().toISOString(),
            cancellation_reason: reason || (isRider ? "Rider cancelled" : "Driver cancelled"),
        };

        // PHASE 8: Failsafes 
        // 1. Rider Penalty ($5 TTD) if canceling on an assigned/arrived driver
        if (isRider && (ride.status === "assigned" || ride.status === "arrived") && ride.driver_id) {
            await supabaseAdmin.from("wallet_transactions").insert([{
                user_id: ride.rider_id,
                ride_id: ride_id,
                amount: -500,
                transaction_type: "cancellation_fee",
                description: "Late cancellation fee ($5 TTD)",
                status: "completed"
            }, {
                user_id: ride.driver_id,
                ride_id: ride_id,
                amount: 500,
                transaction_type: "cancellation_fee",
                description: "Compensation for rider cancellation",
                status: "completed"
            }]);
        }

        // 2. Driver Platform Leakage Trapdoor
        // If driver cancels *after* arrival, schedule a 3-minute proximity audit
        if (isDriver && ride.status === "arrived") {
            updatePayload.audit_needed_at = new Date(Date.now() + 3 * 60 * 1000).toISOString();
        }

        // 4. UPDATE RIDE STATUS (Atomic)
        const { data: updatedRide, error: updateError } = await supabaseAdmin
            .from("rides")
            .update(updatePayload)
            .eq("id", ride_id)
            .in("status", cancellableStatuses)
            .select()
            .single();

        if (updateError || !updatedRide) {
            console.error("Update error or no rows matching:", updateError);
            return new Response(
                JSON.stringify({ success: false, error: "Failed to cancel ride: already in progress or completed", data: null }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // AI LAYER: Log ride_cancelled event
        await supabaseAdmin.from("user_events").insert({
            user_id: userId,
            event_type: "ride_cancelled",
            payload: { 
                ride_id, 
                reason: updatePayload.cancellation_reason,
                was_rider: isRider
            }
        });

        return new Response(
            JSON.stringify({
                success: true,
                error: null,
                data: {
                    ride_id,
                    status: "cancelled",
                },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("Cancel ride error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error", data: null }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
