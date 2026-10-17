// Supabase Edge Function: decline_ride
// Called by Driver App when rejecting a ride offer.
// Forces strict backend authority over offer state.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireDriver } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";

import { getCorsHeaders } from "../_shared/cors.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;


serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { offer_id } = await req.json();

        if (!offer_id) {
            return new Response(JSON.stringify({ success: false, error: "offer_id required" }), { status: 400, headers: corsHeaders });
        }

        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { user, driver } = await requireDriver(req, supabaseAdmin);

        const rateCheck = await checkRateLimit(supabaseAdmin, user.id, "decline_ride");
        if (!rateCheck.allowed) {
            return new Response(JSON.stringify({ success: false, error: rateCheck.error }), { status: 429, headers: corsHeaders });
        }

        // Update offer to declined
        const { error: updateError } = await supabaseAdmin
            .from("ride_offers")
            .update({ status: "declined" })
            .eq("id", offer_id)
            .eq("driver_id", driver.id)
            .eq("status", "pending");

        if (updateError) {
            console.error("Decline error:", updateError);
            return new Response(JSON.stringify({ success: false, error: "Failed to decline offer" }), { status: 500, headers: corsHeaders });
        }

        // We do NOT call match_driver from here to avoid recursive timeouts.
        // The Rider App watches the `ride_offers` table and will automatically 
        // trigger match_driver when it sees this offer turn "declined".

        return new Response(
            JSON.stringify({ success: true, message: "Offer declined successfully" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error: any) {
        console.error("Decline error:", error);
        if (error instanceof Response) return error;
        return new Response(JSON.stringify({ success: false, error: "Internal server error" }), { status: 500, headers: corsHeaders });
    }
});
