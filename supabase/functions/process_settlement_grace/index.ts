import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("PLATFORM_CRON_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const cronHeader = req.headers.get("x-cron-secret");

  if (cronHeader !== CRON_SECRET) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const anon = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error } = await anon.auth.getUser(authHeader.replace("Bearer ", ""));
    if (error || !user) return json({ error: "Invalid or expired token" }, 401);
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: profile, error: pErr } = await supabaseAdmin.from("profiles").select("role").eq("id", user.id).single();
    if (pErr || profile?.role !== "admin") return json({ error: "Forbidden: admin role required" }, 403);
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: results, error } = await supabaseAdmin
      .rpc("process_settlement_grace");

    if (error) throw error;

    return json({ success: true, data: { actions: results || [] } });
  } catch (error: any) {
    console.error("process_settlement_grace error:", error);
    if (error instanceof Response) return error;
    return json({ success: false, error: "Internal server error" }, 500);
  }
});
