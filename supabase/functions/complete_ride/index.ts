// Supabase Edge Function: complete_ride
// Path: supabase/functions/complete_ride/index.ts
//
// Marks a ride as completed.

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

        const body: RequestBody = await req.json();
        const { ride_id } = body;

        if (!ride_id) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing ride_id", data: null }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // Update status to 'completed'
        const { data: ride, error } = await supabase
            .from("rides")
            .update({ status: "completed" })
            .eq("id", ride_id)
            .in("status", ["assigned", "in_progress"])
            .select()
            .single();

        if (error) {
            console.error("Complete ride error:", error);
            return new Response(
                JSON.stringify({ success: false, error: "Failed to complete ride", data: null }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        return new Response(
            JSON.stringify({
                success: true,
                error: null,
                data: {
                    ride_id: ride.id,
                    status: "completed",
                    total_fare_cents: ride.total_fare_cents,
                },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("complete_ride error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error", data: null }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
