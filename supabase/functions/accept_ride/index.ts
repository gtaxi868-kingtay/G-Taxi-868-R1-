// Supabase Edge Function: accept_ride
// Path: supabase/functions/accept_ride/index.ts
//
// Called by Driver App when satisfying a ride request.
// Atomic transaction to lock the ride.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface RequestBody {
    ride_id: string;
    driver_id: string; // In production, extract from Auth.
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
        const body: RequestBody = await req.json();
        const { ride_id, driver_id } = body;

        if (!ride_id || !driver_id) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing ride_id or driver_id" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // 1. ATOMIC UPDATE
        // Only update if status is 'searching' or 'requested'.
        // This prevents race conditions where two drivers accept same ride.
        const { data, error } = await supabase
            .from("rides")
            .update({
                status: "assigned",
                driver_id: driver_id,
                updated_at: new Date().toISOString()
            })
            .eq("id", ride_id)
            .in("status", ["requested", "searching"]) // CRITICAL: Concurrency Control
            .select()
            .single();

        if (error || !data) {
            console.error("Accept failed:", error);
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "Ride unavailable or already taken."
                }),
                { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 2. Log Event
        await supabase.from("events").insert({
            user_id: driver_id, // assuming driver_id is uuid mapping to auth
            role: "driver",
            event_type: "ride_accepted",
            metadata: { ride_id, driver_id }
        });

        return new Response(
            JSON.stringify({ success: true, data }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("accept_ride error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Internal Error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
