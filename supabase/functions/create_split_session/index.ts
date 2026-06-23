// P3.1: Create a group split-payment session for a fête or group ride.
// Creator sets total fare and participant count. Each pays equal share.

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

    const { total_cents, participant_count, title, ride_id } = await req.json();

    if (!total_cents || total_cents <= 0) {
      return new Response(JSON.stringify({ error: "Invalid total_cents" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!participant_count || participant_count < 2 || participant_count > 20) {
      return new Response(JSON.stringify({ error: "participant_count must be 2-20" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const share_cents = Math.floor(total_cents / participant_count);

    const { data: session, error: insertErr } = await supabaseAdmin
      .from("split_sessions")
      .insert({
        creator_id: user.id,
        ride_id: ride_id || null,
        total_cents,
        participant_count,
        share_cents,
        title: title || "Group Ride",
        status: "collecting",
      })
      .select()
      .single();

    if (insertErr) {
      console.error("Failed to create split session:", insertErr);
      return new Response(JSON.stringify({ error: "Failed to create session" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true, data: session }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("create_split_session error:", err);
    if (err instanceof Response) return err;
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
