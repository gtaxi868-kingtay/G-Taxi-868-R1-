import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireDriver } from "../_shared/auth.ts";

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
        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { user, driver } = await requireDriver(req, supabaseAdmin);

        const { offer_id } = await req.json();

        if (!offer_id) {
            return new Response(JSON.stringify({ success: false, error: "offer_id required" }), { status: 400, headers: corsHeaders });
        }

        const { data: offer } = await supabaseAdmin
            .from("ride_offers")
            .select("driver_id")
            .eq("id", offer_id)
            .single();

        if (!offer) {
            return new Response(JSON.stringify({ success: false, error: "Offer not found" }), { status: 404, headers: corsHeaders });
        }

        if (offer.driver_id !== driver.id) {
            return new Response(JSON.stringify({ success: false, error: "Forbidden" }), { status: 403, headers: corsHeaders });
        }

        const { error: updateError } = await supabaseAdmin
            .from("ride_offers")
            .update({ status: "expired" })
            .eq("id", offer_id)
            .eq("status", "pending");

        if (updateError) {
            console.error("Expire error:", updateError);
            return new Response(JSON.stringify({ success: false, error: "Failed to expire offer" }), { status: 500, headers: corsHeaders });
        }

        return new Response(
            JSON.stringify({ success: true, message: "Offer marked as expired" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("Expire error:", error);
        if (error instanceof Response) return error;
        return new Response(JSON.stringify({ success: false, error: "Internal server error" }), { status: 500, headers: corsHeaders });
    }
});
