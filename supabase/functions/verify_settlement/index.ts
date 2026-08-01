// Supabase Edge Function: verify_settlement
// P2: Admin/auto-verifies a settlement request.
// On verify: credits the driver's wallet with the settlement amount.
// On reject: marks as rejected, driver can resubmit.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function requireAdminInline(req: Request): Promise<{ user: any }> {
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
      const { data: wallet } = await supabaseAdmin
        .from("wallets")
        .select("balance_cents")
        .eq("user_id", settlement.driver_id)
        .single();

      if (wallet) {
        await supabaseAdmin
          .from("wallets")
          .update({ balance_cents: (wallet.balance_cents || 0) + settlement.amount_cents })
          .eq("user_id", settlement.driver_id);
      }

      const graceUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await supabaseAdmin
        .from("settlement_requests")
        .update({
          status: "grace_period",
          grace_period_until: graceUntil,
          verified_by: user.id,
          verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", settlement_id);

      await supabaseAdmin.rpc("log_payment_ledger", {
        p_ride_id: null,
        p_user_id: settlement.driver_id,
        p_amount_cents: settlement.amount_cents,
        p_type: "cash_settlement",
        p_description: `Conditional credit (30min grace) — ${settlement.method} (${settlement.reference_token || "no ref"})`,
      }).then((__r) => __r, () => {});

      return new Response(
        JSON.stringify({
          success: true,
          data: { status: "grace_period", credited_cents: settlement.amount_cents, grace_period_minutes: 30 },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Reject
    await supabaseAdmin
      .from("settlement_requests")
      .update({
        status: "rejected",
        verified_by: user.id,
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", settlement_id);

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
