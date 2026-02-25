// Supabase Edge Function: expire_offer
// Called by the Rider App's "Heartbeat" loop when an offer has sat pending for > 15s.
// Transitions the stuck offer and triggers the next cascade.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
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
        const { offer_id } = await req.json();

        if (!offer_id) {
            return new Response(JSON.stringify({ success: false, error: "offer_id required" }), { status: 400, headers: corsHeaders });
        }

        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // Force expiration to prune the dead ping
        const { error: updateError } = await supabaseAdmin
            .from("ride_offers")
            .update({ status: "expired" })
            .eq("id", offer_id)
            .eq("status", "pending");

        if (updateError) {
            console.error("Expire error:", updateError);
            return new Response(JSON.stringify({ success: false, error: "Failed to expire offer" }), { status: 500, headers: corsHeaders });
        }

        // Rider App will watch for this 'expired' status and immediately re-trigger match_driver.

        return new Response(
            JSON.stringify({ success: true, message: "Offer marked as expired" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("Expire error:", error);
        return new Response(JSON.stringify({ success: false, error: "Internal server error" }), { status: 500, headers: corsHeaders });
    }
});
