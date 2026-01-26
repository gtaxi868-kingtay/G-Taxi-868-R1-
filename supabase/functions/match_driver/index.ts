// Supabase Edge Function: match_driver
// Path: supabase/functions/match_driver/index.ts
//
// STUB: Simulates driver matching for development.
// In production, this would query nearby drivers and assign one.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Simulated driver data (stub)
const DEMO_DRIVER = {
    name: "Marcus Johnson",
    vehicle: "Toyota Corolla",
    plate: "TAX 1234",
    rating: 4.9,
    phone: "+1 868 555 0123",
};

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
        // Verify authorization
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

        // First, update status to 'searching'
        const { error: searchingError } = await supabase
            .from("rides")
            .update({ status: "searching" })
            .eq("id", ride_id)
            .eq("status", "requested");

        if (searchingError) {
            console.error("Error updating to searching:", searchingError);
            return new Response(
                JSON.stringify({ success: false, error: "Failed to start search", data: null }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Simulate driver search delay (2-4 seconds)
        const delay = 2000 + Math.random() * 2000;
        await new Promise(resolve => setTimeout(resolve, delay));

        // Update status to 'assigned'
        const { error: assignedError } = await supabase
            .from("rides")
            .update({ status: "assigned" })
            .eq("id", ride_id)
            .eq("status", "searching");

        if (assignedError) {
            console.error("Error updating to assigned:", assignedError);
            return new Response(
                JSON.stringify({ success: false, error: "Failed to assign driver", data: null }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        return new Response(
            JSON.stringify({
                success: true,
                error: null,
                data: {
                    ride_id,
                    status: "assigned",
                    driver: DEMO_DRIVER,
                },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("match_driver error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error", data: null }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
