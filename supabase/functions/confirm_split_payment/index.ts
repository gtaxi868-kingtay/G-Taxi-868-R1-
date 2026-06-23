// P3.1: Finalize split-payment — charge all confirmed participants via wallet.
// Creator calls this once all participants confirmed.

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

    if (session.creator_id !== user.id) {
      return new Response(JSON.stringify({ error: "Only the creator can confirm payment" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (session.status !== "collecting") {
      return new Response(JSON.stringify({ error: `Session already ${session.status}` }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: participants, error: partErr } = await supabaseAdmin
      .from("split_participants")
      .select("*")
      .eq("session_id", session_id);

    if (partErr) throw partErr;

    if (!participants || participants.length < session.participant_count - 1) {
      return new Response(JSON.stringify({ error: "Not all participants have joined yet" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const allConfirmed = participants.every((p: any) => p.status === "confirmed");
    if (!allConfirmed) {
      return new Response(JSON.stringify({ error: "Some participants have not confirmed" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const charged: string[] = [];
    const failed: string[] = [];

    for (const p of participants) {
      const { data: wallet } = await supabaseAdmin
        .from("wallets")
        .select("balance_cents")
        .eq("user_id", p.user_id)
        .single();

      if (wallet && wallet.balance_cents >= p.amount_cents) {
        const { error: deductErr } = await supabaseAdmin.rpc("process_wallet_payment_hardened", {
          p_driver_id: null,
          p_ride_id: session.ride_id || null,
          p_gross_fare_cents: p.amount_cents,
          p_platform_fee_cents: 0,
          p_driver_payout_cents: p.amount_cents,
          p_reserve_cents: 0,
        });

        if (!deductErr) {
          await supabaseAdmin
            .from("split_participants")
            .update({ status: "charged", charged_at: new Date().toISOString() })
            .eq("id", p.id);
          charged.push(p.user_id);
        } else {
          failed.push(p.user_id);
        }
      } else {
        failed.push(p.user_id);
      }
    }

    if (failed.length === 0) {
      await supabaseAdmin.from("split_sessions").update({ status: "confirmed" }).eq("id", session_id);
    }

    return new Response(JSON.stringify({ success: true, data: { charged, failed, session_status: failed.length === 0 ? "confirmed" : "partial" } }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("confirm_split_payment error:", err);
    if (err instanceof Response) return err;
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
