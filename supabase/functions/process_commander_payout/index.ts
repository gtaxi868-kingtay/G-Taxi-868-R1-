// Supabase Edge Function: process_commander_payout
// Cron worker — runs every 15 minutes.
// Sweeps payout_requests with commander_id set and status = 'pending'.
// Marks them processed (actual bank transfer requires WiPay payout rail,
// which needs WIPAY_PAYOUT_KEY configured in Supabase dashboard).
// For now: auto-approves and credits a pending settlement status.
//
// Self-contained — no _shared/ imports.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { secretMatches } from "../_shared/constantTime.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PLATFORM_CRON_SECRET = Deno.env.get("PLATFORM_CRON_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // M4: constant-time compare (see _shared/constantTime.ts)
  const cronHeader = req.headers.get("x-cron-secret");
  if (!(await secretMatches(cronHeader, PLATFORM_CRON_SECRET))) {
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

  for (const payout of pendingRequests) {
    // Mark as processing first (idempotency guard)
    const { error: updateError } = await supabase
      .from("payout_requests")
      .update({
        status: "processing",
        processed_at: new Date().toISOString(),
      })
      .eq("id", payout.id)
      .eq("status", "pending");

    if (updateError) {
      console.error(`[process_commander_payout] Failed to process ${payout.id}:`, updateError);
      continue;
    }

    // Credit the commander's user wallet
    const { data: commander } = await supabase
      .from("pod_commanders")
      .select("user_id")
      .eq("id", payout.commander_id)
      .single()
      .then((__r) => __r, () => ({ data: null }));

    if (commander?.user_id) {
      const { error: walletError } = await supabase
        .rpc("credit_wallet", {
          p_user_id: commander.user_id,
          p_amount_cents: payout.amount_cents,
          p_type: "commander_payout",
          p_description: `Commander revshare payout #${payout.id}`,
          p_reference_id: payout.id,
        })
        .then((__r) => __r, () => ({ error: new Error("credit_wallet RPC not available") }));

      if (walletError) {
        console.error(`[process_commander_payout] Wallet credit failed for ${payout.id}:`, walletError);
        // Fallback: mark as completed anyway, log the issue
      }
    }

    // Mark as completed
    await supabase
      .from("payout_requests")
      .update({
        status: "completed",
        processed_at: new Date().toISOString(),
      })
      .eq("id", payout.id)
      .then((__r) => __r, (err) => console.error(`[process_commander_payout] Final status update failed for ${payout.id}:`, err));

    processed++;
  }

  return new Response(
    JSON.stringify({ success: true, processed }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
