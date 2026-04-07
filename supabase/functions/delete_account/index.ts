// Supabase Edge Function: delete_account
// LEGAL/GDPR COMPLIANCE MANDATE: APP STORE REQUIREMENT
//
// Allows an authenticated user to completely purge their account and data.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

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
        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: req.headers.get("Authorization")! } },
        });

        // 1. Authenticate the caller
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
        if (authError || !user) {
            throw new Error("Unauthorized to perform account deletion.");
        }

        // 2. We must use the Service Role to bypass RLS and delete from the 'auth.users' system table
        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // Optional Step: We could delete public.users, but we have ON DELETE CASCADE
        // configured on the auth.users foreign keys for (users, riders, drivers, wallet_balances).
        // Therefore, deleting auth.users automatically triggers the wipe of personal data.
        
        console.log(`[GDPR DELETE] Executing hard purge for User ID: ${user.id}`);
        
        const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);
        
        if (deleteError) {
            throw deleteError;
        }

        return new Response(
            JSON.stringify({ 
                success: true, 
                message: "Account and associated data deleted permanently."
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error: any) {
        console.error("delete_account error:", error);
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
