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
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        // G-TAXI HARDENING: Fix 12/15 - Handle column-based single row config
        const { data: configRows } = await supabase.from("system_config").select("*").eq("id", "global").limit(1);
        const config = configRows?.[0] || {};

        const status = {
            stripe_ready: !!Deno.env.get("STRIPE_SECRET_KEY"),
            fcm_ready: !!Deno.env.get("FCM_SERVER_KEY") || !!Deno.env.get("FIREBASE_SERVICE_ACCOUNT"),
            mapbox_ready: !!Deno.env.get("MAPBOX_ACCESS_TOKEN"),
            twilio_ready: !!Deno.env.get("TWILIO_ACCOUNT_SID"), // Fix 9: SMS Fallback
            supabase_ready: !!SUPABASE_URL,
            config: config,
        };

        return new Response(
            JSON.stringify({ success: true, data: status }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (error: any) {
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
