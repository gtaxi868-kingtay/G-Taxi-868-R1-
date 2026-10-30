import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/auth.ts";
import { secretMatches } from "../_shared/constantTime.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PLATFORM_CRON_SECRET = Deno.env.get("PLATFORM_CRON_SECRET");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth gate (register item #1): this endpoint debits merchant wallets, so
    // every call must prove who it is. Either the cron secret (constant-time
    // compare, fail-closed when PLATFORM_CRON_SECRET is unset — same gate as
    // process_commander_payout / process_settlement_grace) or an admin user
    // via requireAdmin. There is no unauthenticated path: the previous
    // "no Authorization header = cron = bypass" branch has been removed.
    const cronHeader = req.headers.get("x-cron-secret");
    const isCron = await secretMatches(cronHeader, PLATFORM_CRON_SECRET);
    if (!isCron) {
      try {
        await requireAdmin(req);
      } catch (e) {
        if (e instanceof Response) return e;
        throw e;
      }
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Step 1: Fetch pending arrival_events grouped by merchant
    const { data: pendingEvents, error: fetchError } = await admin
      .from("arrival_events")
      .select("id, merchant_id")
      .eq("status", "pending");

    if (fetchError) {
      console.error("Failed to fetch pending arrival_events:", fetchError);
      return new Response(
        JSON.stringify({ success: false, error: "Database error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!pendingEvents || pendingEvents.length === 0) {
      return new Response(
        JSON.stringify({ success: true, data: { events_charged: 0 } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 2: Group event ids by merchant
    const merchantMap = new Map<string, string[]>();
    for (const event of pendingEvents) {
      const ids = merchantMap.get(event.merchant_id) || [];
      ids.push(event.id);
      merchantMap.set(event.merchant_id, ids);
    }

    // Step 3: Charge each merchant atomically via charge_merchant_pin_fee_batch.
    // That RPC locks the arrival_events rows with FOR UPDATE and re-checks
    // status = 'pending' after the lock, does the wallet debit and
    // arrival_events status update in one transaction, and raises an admin
    // alert (instead of failing silently) when the merchant has no linked
    // owner account. A single RPC call per merchant is the whole unit of
    // work — no separate read-then-write from this function.
    let chargedCount = 0;
    let failedCount = 0;

    for (const [merchantId, ids] of merchantMap) {
      const { data, error: rpcError } = await admin.rpc("charge_merchant_pin_fee_batch", {
        p_merchant_id: merchantId,
        p_event_ids: ids,
      });

      if (rpcError) {
        console.error(`charge_merchant_pin_fee_batch failed for merchant ${merchantId}:`, rpcError);
        failedCount += ids.length;
        continue;
      }

      const result = Array.isArray(data) ? data[0] : data;
      chargedCount += result?.charged_count ?? 0;
      failedCount += result?.failed_count ?? 0;
    }

    console.log(`Pin fee batch: ${chargedCount} charged, ${failedCount} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          events_charged: chargedCount,
          events_failed: failedCount,
          merchants_processed: merchantMap.size,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("charge_merchant_pin_fees error:", error);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
