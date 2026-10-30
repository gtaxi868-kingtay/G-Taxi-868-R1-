// Supabase Edge Function: verify_settlement
// P2: Admin/auto-verifies a settlement request.
// On verify: credits the driver's wallet with the settlement amount.
// On reject: marks as rejected, driver can resubmit.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function requireAdminInline(req: Request): Promise<{ user: any }> {
  const corsHeaders = getCorsHeaders(req);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw new Response(JSON.stringify({ error: 'Missing authorization header' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  const anon = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data: { user }, error } = await anon.auth.getUser(authHeader.replace('Bearer ', ''));
  if (error || !user) throw new Response(JSON.stringify({ error: 'Invalid or expired token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: profile, error: pErr } = await admin.from('profiles').select('role').eq('id', user.id).single();
  if (pErr || profile?.role !== 'admin') throw new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  return { user };
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { user } = await requireAdminInline(req);

    const body = await req.json();
    const { settlement_id, action } = body;

    if (!settlement_id || !action || !["verify", "reject"].includes(action)) {
      return new Response(
        JSON.stringify({ success: false, error: "settlement_id and action (verify|reject) required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: settlement, error: fetchErr } = await supabaseAdmin
      .from("settlement_requests")
      .select("*")
      .eq("id", settlement_id)
      .single();

    if (fetchErr || !settlement) {
      return new Response(
        JSON.stringify({ success: false, error: "Settlement request not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (settlement.status !== "pending") {
      return new Response(
        JSON.stringify({ success: false, error: `Settlement already ${settlement.status}` }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "verify") {
      // Phase 5: Conditional credit with 30-min grace period.
      // Wallet is credited immediately but will be auto-reversed if
      // no bank webhook confirmation arrives within 30 minutes.
      //
      // Double-credit guard (register #5): the credit goes through the
      // credit_wallet RPC, which takes an advisory lock on the reference id,
      // refuses a second credit for the same settlement, increments
      // wallets.balance_cents atomically in SQL (never a read-modify-write
      // from this function), creates the wallet row if the driver has none,
      // and writes the wallet_transactions ledger row. The request is then
      // CLAIMED with a status-guarded update (WHERE status = 'pending'); if
      // the claim returns no row, another verify already processed it and
      // this call reports no credit of its own.
      const { data: creditResult, error: creditErr } = await supabaseAdmin.rpc("credit_wallet", {
        p_user_id: settlement.driver_id,
        p_amount_cents: settlement.amount_cents,
        p_type: "cash_settlement",
        p_description: `Conditional credit (30min grace) — ${settlement.method} (${settlement.reference_token || "no ref"})`,
        p_reference_id: `settlement:${settlement_id}`,
      });

      if (creditErr || !creditResult?.success) {
        console.error("verify_settlement credit_wallet failed:", creditErr || creditResult);
        return new Response(
          JSON.stringify({ success: false, error: "Wallet credit failed — settlement left pending for retry" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const graceUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const { data: claimed, error: claimErr } = await supabaseAdmin
        .from("settlement_requests")
        .update({
          status: "grace_period",
          grace_period_until: graceUntil,
          verified_by: user.id,
          verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", settlement_id)
        .eq("status", "pending")
        .select("id");

      if (claimErr) {
        console.error("verify_settlement claim failed:", claimErr);
        return new Response(
          JSON.stringify({ success: false, error: "Failed to update settlement request" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!claimed || claimed.length === 0) {
        // Lost the race: another verify/reject already transitioned this
        // request. credit_wallet's idempotency key means the wallet was
        // credited at most once across both calls — by the winner, not here.
        return new Response(
          JSON.stringify({ success: false, error: "Settlement already processed", data: { credited_cents: 0 } }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error: ledgerErr } = await supabaseAdmin.rpc("log_payment_ledger", {
        p_ride_id: null,
        p_user_id: settlement.driver_id,
        p_amount_cents: settlement.amount_cents,
        p_type: "cash_settlement",
        p_description: `Conditional credit (30min grace) — ${settlement.method} (${settlement.reference_token || "no ref"})`,
      });
      if (ledgerErr) {
        // Secondary audit log only — the wallet_transactions row written by
        // credit_wallet is the authoritative ledger. Log, don't hide.
        console.error("verify_settlement log_payment_ledger failed:", ledgerErr);
      }

      return new Response(
        JSON.stringify({
          success: true,
          data: { status: "grace_period", credited_cents: settlement.amount_cents, grace_period_minutes: 30 },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Reject — same status-guarded claim: only a still-pending request can
    // be rejected by this call.
    const { data: rejected, error: rejectErr } = await supabaseAdmin
      .from("settlement_requests")
      .update({
        status: "rejected",
        verified_by: user.id,
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", settlement_id)
      .eq("status", "pending")
      .select("id");

    if (rejectErr) {
      console.error("verify_settlement reject failed:", rejectErr);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to update settlement request" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!rejected || rejected.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Settlement already processed" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, data: { status: "rejected" } }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("verify_settlement error:", error);
    if (error instanceof Response) return error;
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
