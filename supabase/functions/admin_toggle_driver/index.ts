// Supabase Edge Function: admin_toggle_driver
// Authorizes or revokes a driver's access to the platform.

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

        // Verify the user calling this is an admin
        const supabaseClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
            global: { headers: { Authorization: authHeader } }
        });
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

        if (authError || !user) {
            return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const { data: profile } = await supabaseAdmin.from("profiles").select("is_admin").eq("id", user.id).single();
        if (!profile || !profile.is_admin) {
            return new Response(JSON.stringify({ error: "Forbidden: Admins only" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const { user_id, action } = await req.json();

        if (!user_id || !["authorize", "revoke"].includes(action)) {
            return new Response(JSON.stringify({ error: "Invalid parameters. require user_id and action ('authorize' or 'revoke')" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        if (action === "authorize") {
            // Get user info to populate driver table if not there
            const { data: targetProfile, error: targetError } = await supabaseAdmin.from("profiles").select("*").eq("id", user_id).single();

            if (targetError) {
                return new Response(JSON.stringify({ error: "Target user profile not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            // Check if driver record already exists
            const { data: existingDriver } = await supabaseAdmin.from("drivers").select("id").eq("user_id", user_id).maybeSingle();

            if (existingDriver) {
                // Already a driver, just ensure they are active/offline
                const { error: updateError } = await supabaseAdmin.from("drivers").update({ status: 'offline' }).eq("user_id", user_id);
                if (updateError) throw updateError;
            } else {
                return new Response(JSON.stringify({ error: "Driver record does not exist. User must register first." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

        } else if (action === "revoke") {
            const { error: updateError } = await supabaseAdmin.from("drivers").update({ status: 'suspended', is_online: false }).eq("user_id", user_id);
            if (updateError) throw updateError;

            // In a real prod env, we'd also want to invalidate their auth session here using the Admin API
            // await supabaseAdmin.auth.admin.signOut(user_id, 'global');
        }

        return new Response(JSON.stringify({ success: true, user_id, action }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (error: any) {
        console.error("admin_toggle_driver error:", error);
        return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
});
