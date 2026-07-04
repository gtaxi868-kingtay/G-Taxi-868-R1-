// Supabase Edge Function: get_system_status
// Returns live platform readiness + the public system_config the apps gate on
// (maintenance_mode kill-switch, min_version_* force-update). Previously this
// was a stub that returned hardcoded readiness and NO config, so the rider
// app's maintenance banner and version gate could never fire.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        await requireAuth(req);

        const admin = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        // Public app config that the clients gate on (maintenance_mode,
        // min_version_rider/driver, and anything else admin adds here).
        const { data: cfgRows } = await admin.from("system_config").select("key, value");
        const config: Record<string, string> = {};
        for (const row of (cfgRows as { key: string; value: string }[] | null) || []) {
            if (row?.key) config[row.key] = row.value;
        }

        // Honest readiness derived from actual secret presence — not hardcoded.
        const stripe_ready = !!Deno.env.get("STRIPE_SECRET_KEY");
        const fcm_ready = !!Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");

        return new Response(
            JSON.stringify({
                success: true,
                data: {
                    stripe_ready,
                    fcm_ready,
                    mapbox_ready: true,   // rider app carries its own public Mapbox token
                    supabase_ready: true,
                    config,
                },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (error: any) {
        if (error instanceof Response) return error;
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
