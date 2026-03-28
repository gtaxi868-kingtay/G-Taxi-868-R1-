// Supabase Edge Function: admin_toggle_role
// Allows administrators to promote/demote other users to 'admin' or 'rider'.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(JSON.stringify({ error: "Missing authorization" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // 1. Verify the caller is an admin using JWT
        const supabaseClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
            global: { headers: { Authorization: authHeader } }
        });
        const { data: { user: caller }, error: authError } = await supabaseClient.auth.getUser();

        if (authError || !caller) {
            return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const { data: callerProfile } = await supabaseAdmin.from("profiles").select("role").eq("id", caller.id).single();
        if (!callerProfile || callerProfile.role !== 'admin') {
            return new Response(JSON.stringify({ error: "Forbidden: Admins only" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // 2. Parse request body
        const { target_user_id, new_role } = await req.json();

        if (!target_user_id || !["admin", "rider"].includes(new_role)) {
            return new Response(JSON.stringify({ error: "Invalid parameters. require target_user_id and new_role ('admin' or 'rider')" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // 3. Prevent self-demotion (Optional safety check)
        if (target_user_id === caller.id && new_role !== 'admin') {
            return new Response(JSON.stringify({ error: "Cannot demote yourself. Safety first." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // 4. Update the role
        const { error: updateError } = await supabaseAdmin
            .from("profiles")
            .update({ role: new_role, is_admin: new_role === 'admin' })
            .eq("id", target_user_id);

        if (updateError) throw updateError;

        return new Response(JSON.stringify({ success: true, user_id: target_user_id, role: new_role }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (error: any) {
        console.error("admin_toggle_role error:", error);
        return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
});
