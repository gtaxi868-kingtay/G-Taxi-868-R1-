// Supabase Edge Function: cancel_ride
// Path: supabase/functions/cancel_ride/index.ts
//
// Cancels an active ride request.
// Only the rider can cancel their own ride.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface RequestBody {
    ride_id: string;
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
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing authorization", data: null }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Verify user
        const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
            global: { headers: { Authorization: authHeader } }
        });

        const { data: { user }, error: userError } = await userClient.auth.getUser();
        if (userError || !user) {
            return new Response(
                JSON.stringify({ success: false, error: "Invalid user token", data: null }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const body: RequestBody = await req.json();
        const { ride_id } = body;

        if (!ride_id) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing ride_id", data: null }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // Get the ride and verify ownership
        const { data: ride, error: fetchError } = await supabase
            .from("rides")
            .select("*")
            .eq("id", ride_id)
            .single();

        if (fetchError || !ride) {
            return new Response(
                JSON.stringify({ success: false, error: "Ride not found", data: null }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Verify the user owns this ride
        if (ride.rider_id !== user.id) {
            return new Response(
                JSON.stringify({ success: false, error: "Not authorized to cancel this ride", data: null }),
                { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Can only cancel if ride is in cancellable state
        const cancellableStates = ["requested", "searching", "assigned"];
        if (!cancellableStates.includes(ride.status)) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: `Cannot cancel ride in ${ride.status} status`,
                    data: null
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Update status to cancelled
        const { error: updateError } = await supabase
            .from("rides")
            .update({ status: "cancelled" })
            .eq("id", ride_id);

        if (updateError) {
            console.error("Cancel error:", updateError);
            return new Response(
                JSON.stringify({ success: false, error: "Failed to cancel ride", data: null }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

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
        console.error("cancel_ride error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error", data: null }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
