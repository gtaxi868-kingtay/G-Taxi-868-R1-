// P3.1: Join a split-payment session. Confirms intent to pay share.

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

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(
      authHeader?.replace("Bearer ", "") ?? ""
    );
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { session_id } = await req.json();

    if (!session_id) {
      return new Response(JSON.stringify({ error: "session_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: session, error: sessErr } = await supabaseAdmin
      .from("split_sessions")
      .select("*")
      .eq("id", session_id)
      .single();

    if (sessErr || !session) {
      return new Response(JSON.stringify({ error: "Session not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (session.status !== "collecting") {
      return new Response(JSON.stringify({ error: "Session is not collecting participants" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (new Date(session.expires_at) < new Date()) {
      await supabaseAdmin.from("split_sessions").update({ status: "expired" }).eq("id", session_id);
      return new Response(JSON.stringify({ error: "Session expired" }), { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: existing } = await supabaseAdmin
      .from("split_participants")
      .select("id")
      .eq("session_id", session_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ error: "Already joined this session" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { count } = await supabaseAdmin
      .from("split_participants")
      .select("id", { count: "exact", head: true })
      .eq("session_id", session_id)
      .neq("user_id", session.creator_id);

    const currentNonCreatorCount = count || 0;
    if (currentNonCreatorCount >= session.participant_count - 1) {
      return new Response(JSON.stringify({ error: "Session is full" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: participant, error: insertErr } = await supabaseAdmin
      .from("split_participants")
      .insert({
        session_id,
        user_id: user.id,
        amount_cents: session.share_cents,
        status: "confirmed",
      })
      .select()
      .single();

    if (insertErr) {
      return new Response(JSON.stringify({ error: "Failed to join session" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true, data: participant }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("join_split_session error:", err);
    if (err instanceof Response) return err;
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
