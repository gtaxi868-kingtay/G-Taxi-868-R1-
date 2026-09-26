// supabase/functions/public_config/index.ts
// PUBLIC, no-auth config for the static tap page (and any other front-door
// surface). Returns the business WhatsApp number in E.164 digits (no +) so
// tap.html never hardcodes it.
//
// Source order: WHATSAPP_DISPLAY_NUMBER env -> system_config
// 'support_whatsapp_number' (admin-editable) -> repo default.
// verify_jwt = false (see supabase/config.toml): the static site has no JWT.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FALLBACK_NUMBER = "18687031000";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
};

serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "GET") {
        return new Response(JSON.stringify({ error: "method not allowed" }), {
            status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    let number = (Deno.env.get("WHATSAPP_DISPLAY_NUMBER") || "").replace(/\D/g, "");
    let source = "env";

    if (!number) {
        try {
            const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
            const { data } = await db.from("system_config")
                .select("value").eq("key", "support_whatsapp_number").maybeSingle();
            const v = ((data as any)?.value || "").replace(/\D/g, "");
            if (v.length >= 7) { number = v; source = "system_config"; }
        } catch (e) {
            console.error("[public_config] system_config read failed:", e);
        }
    }
    if (!number) { number = FALLBACK_NUMBER; source = "default"; }

    return new Response(JSON.stringify({ whatsapp_number: number, source }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
});
