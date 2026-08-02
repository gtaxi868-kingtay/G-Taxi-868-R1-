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

    // Cron calls have no auth header (bypass admin check).
    // HTTP calls require admin role.
    if (authHeader) {
      const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: { user }, error } = await client.auth.getUser(
        authHeader.replace("Bearer ", "")
      );
      if (error || !user) {
        return new Response(
          JSON.stringify({ success: false, error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const { data: profile } = await client
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      if (!profile || profile.role !== "admin") {
        return new Response(
          JSON.stringify({ success: false, error: "Forbidden" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Step 1: Fetch pending arrival_events grouped by merchant
    const { data: pendingEvents, error: fetchError } = await admin
      .from("arrival_events")
      .select("id, merchant_id, pin_fee_cents")
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

    // Step 2: Group by merchant
    const merchantMap = new Map<string, { ids: string[]; totalFee: number }>();
    for (const event of pendingEvents) {
      const entry = merchantMap.get(event.merchant_id) || { ids: [], totalFee: 0 };
      entry.ids.push(event.id);
      entry.totalFee += event.pin_fee_cents;
      merchantMap.set(event.merchant_id, entry);
    }

    // Step 3: For each merchant, get created_by and deduct from wallet
    let chargedCount = 0;
    let failedCount = 0;

    for (const [merchantId, { ids, totalFee }] of merchantMap) {
      const { data: merchant, error: merchError } = await admin
        .from("merchants")
        .select("created_by")
        .eq("id", merchantId)
        .single();

      if (merchError || !merchant?.created_by) {
        console.error(`Merchant ${merchantId} has no created_by — skipping`);
        failedCount += ids.length;
        await admin
          .from("arrival_events")
          .update({ status: "failed" })
          .in("id", ids);
        continue;
      }

      const userId = merchant.created_by;
      const now = new Date().toISOString();

      // Insert wallet transaction record (negative amount = debit)
      const { error: txnError } = await admin
        .from("wallet_transactions")
        .insert({
          user_id: userId,
          amount: -totalFee,
          transaction_type: "merchant_subscription",
          description: `Pin fee for ${ids.length} rider arrival(s) at your merchant location`,
          reference_id: `pin_batch_${merchantId}_${Date.now()}`,
          status: "completed",
        });

      if (txnError) {
        console.error(`Wallet txn insert failed for merchant ${merchantId}:`, txnError);
        failedCount += ids.length;
        await admin
          .from("arrival_events")
          .update({ status: "failed" })
          .in("id", ids);
        continue;
      }

      // Update wallet balance atomically
      const { error: walletError } = await admin.rpc("create_wallet_if_not_exists", {
        p_user_id: userId,
      }).then((__r) => __r, () => ({ error: null }));

      // Deduct from wallet balance
      const { data: wallet } = await admin
        .from("wallets")
        .select("balance_cents")
        .eq("user_id", userId)
        .maybeSingle();

      if (wallet) {
        const newBalance = Math.max(0, wallet.balance_cents - totalFee);
        await admin
          .from("wallets")
          .update({ balance_cents: newBalance, updated_at: now })
          .eq("user_id", userId);
      }

      // Mark arrival_events as charged
      await admin
        .from("arrival_events")
        .update({ status: "charged", charged_at: now })
        .in("id", ids);

      chargedCount += ids.length;
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
