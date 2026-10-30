// Supabase Edge Function: process_commander_payout
// Cron worker — runs every 15 minutes.
// Sweeps payout_requests with commander_id set and status = 'pending'.
// Credits each claimed payout to the commander's user wallet via the
// credit_wallet RPC (actual bank transfer requires the WiPay payout rail,
// which needs WIPAY_PAYOUT_KEY configured in Supabase dashboard).
// A payout is marked 'completed' ONLY after its wallet credit succeeds:
// a failed credit returns the row to 'pending' for the next sweep.
//
// Self-contained — no _shared/ imports.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PLATFORM_CRON_SECRET = Deno.env.get("PLATFORM_CRON_SECRET") ?? "";


Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const cronHeader = req.headers.get("x-cron-secret");
  if (!PLATFORM_CRON_SECRET || cronHeader !== PLATFORM_CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: pendingRequests, error: fetchError } = await supabase
    .from("payout_requests")
    .select("id, commander_id, amount_cents, created_at")
    .not("commander_id", "is", null)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (fetchError) {
    console.error("[process_commander_payout] Fetch error:", fetchError);
    return new Response(JSON.stringify({ error: fetchError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!pendingRequests?.length) {
    return new Response(JSON.stringify({ success: true, processed: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let processed = 0;
  let failed = 0;

  for (const payout of pendingRequests) {
    // Claim the row first: this status-guarded update only flips a row
    // that is still 'pending', and we verify a row actually transitioned.
    // Overlapping cron runs therefore cannot both credit the same payout —
    // the loser claims zero rows and skips.
    const { data: claimed, error: claimError } = await supabase
      .from("payout_requests")
      .update({
        status: "processing",
        processed_at: new Date().toISOString(),
      })
      .eq("id", payout.id)
      .eq("status", "pending")
      .select("id");

    if (claimError) {
      console.error(`[process_commander_payout] Failed to claim ${payout.id}:`, claimError);
      failed++;
      continue;
    }
    if (!claimed?.length) {
      console.log(`[process_commander_payout] Skipping ${payout.id}: already claimed or no longer pending`);
      continue;
    }

    // Release the claim (processing → pending) so a later sweep can retry.
    // Only ever used when NO credit happened; once credit_wallet succeeds
    // the row is never released (see the completion step below).
    const releaseClaim = async (reason: string) => {
      const { error: releaseError } = await supabase
        .from("payout_requests")
        .update({ status: "pending" })
        .eq("id", payout.id)
        .eq("status", "processing");
      if (releaseError) {
        console.error(`[process_commander_payout] CRITICAL: could not release claim on ${payout.id} (${reason}); row left in 'processing' for manual review:`, releaseError);
      }
    };

    // Credit the commander's user wallet
    const { data: commander } = await supabase
      .from("pod_commanders")
      .select("user_id")
      .eq("id", payout.commander_id)
      .single()
      .then((__r) => __r, () => ({ data: null }));

    if (!commander?.user_id) {
      console.error(`[process_commander_payout] Payout ${payout.id}: commander ${payout.commander_id} has no user_id — cannot credit. Returning payout to 'pending'.`);
      await releaseClaim("commander has no user_id");
      failed++;
      continue;
    }

    // Idempotency backstop: if a previous run credited this payout but
    // died before marking it completed (e.g. the RPC committed while the
    // response was lost), the credit already sits in wallet_transactions
    // under this function's own description convention — do not credit a
    // second time; fall through to the completion step instead.
    const creditDescription = `Commander revshare payout #${payout.id}`;
    const { data: priorCredit } = await supabase
      .from("wallet_transactions")
      .select("id")
      .eq("user_id", commander.user_id)
      .eq("transaction_type", "commander_payout")
      .eq("description", creditDescription)
      .limit(1)
      .then((__r) => __r, () => ({ data: null }));

    if (!priorCredit?.length) {
      const { error: walletError } = await supabase
        .rpc("credit_wallet", {
          p_user_id: commander.user_id,
          p_amount_cents: payout.amount_cents,
          p_type: "commander_payout",
          p_description: creditDescription,
          p_reference_id: payout.id,
        })
        .then((__r) => __r, () => ({ error: new Error("credit_wallet RPC not available") }));

      if (walletError) {
        // The credit did NOT happen. Never mark this payout completed —
        // return it to 'pending' so the next sweep retries it, and log
        // loudly: a commander is waiting on this money.
        console.error(`[process_commander_payout] WALLET CREDIT FAILED for payout ${payout.id} (commander ${payout.commander_id}, ${payout.amount_cents} cents). Payout returned to 'pending' for retry:`, walletError);
        await releaseClaim("wallet credit failed");
        failed++;
        continue;
      }
    } else {
      console.log(`[process_commander_payout] Payout ${payout.id} already credited in a prior run; marking completed without re-crediting.`);
    }

    // Mark as completed — only from the 'processing' state we claimed,
    // and verify the row actually transitioned. If this fails, the money
    // HAS moved, so the row is deliberately left in 'processing' (an
    // honest "credit done, bookkeeping failed" state) rather than
    // released to 'pending', which would risk a second credit.
    const { data: completedRows, error: completeError } = await supabase
      .from("payout_requests")
      .update({
        status: "completed",
        processed_at: new Date().toISOString(),
      })
      .eq("id", payout.id)
      .eq("status", "processing")
      .select("id");

    if (completeError || !completedRows?.length) {
      console.error(`[process_commander_payout] CRITICAL: wallet credited for payout ${payout.id} but completion marking failed; row left in 'processing' for manual reconciliation:`, completeError ?? "no row transitioned");
      failed++;
      continue;
    }

    processed++;
  }

  return new Response(
    JSON.stringify({ success: true, processed, failed }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
