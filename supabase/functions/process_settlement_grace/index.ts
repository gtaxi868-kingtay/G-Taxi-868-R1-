// Phase 5: Sweep function for grace-period settlement reversals.
// Called by cron (every 5 min) or manually triggered.
// Confirms settlements where bank confirmation arrived within 30 min.
// Reverses wallet credits where grace period expired with no bank confirmation.

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
    const authHeader = req.headers.get("Authorization");
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (authHeader) {
      const anon = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!);
      const { data: { user }, error } = await anon.auth.getUser(authHeader.replace("Bearer ", ""));
      if (error || !user) throw new Response(JSON.stringify({ error: "Invalid or expired token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: profile, error: pErr } = await supabaseAdmin.from("profiles").select("role").eq("id", user.id).single();
      if (pErr || profile?.role !== "admin") throw new Response(JSON.stringify({ error: "Forbidden: admin role required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: results, error } = await supabaseAdmin
      .rpc("process_settlement_grace");

    if (error) throw error;

    return new Response(
      JSON.stringify({ success: true, data: { actions: results || [] } }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("process_settlement_grace error:", error);
    if (error instanceof Response) return error;
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
