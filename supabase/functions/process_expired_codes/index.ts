// Supabase Edge Function: process_expired_codes
// Cron worker — runs every 30 minutes.
// Sweeps cash_withdrawal_codes where status = 'active' AND expires_at < now().
// Calls expire_stale_withdrawal_codes() RPC which auto-refunds the wallet.
//
// Self-contained — no _shared/ imports.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  const cronHeader = req.headers.get("x-cron-secret");
  if (!PLATFORM_CRON_SECRET || cronHeader !== PLATFORM_CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Find stale codes for notification
  const { data: staleCodes } = await supabase
    .from("cash_withdrawal_codes")
    .select("id, user_id, amount_cents, code, expires_at")
    .eq("status", "active")
    .lt("expires_at", new Date().toISOString())
    .limit(50);

  const { data: expiredCount, error: rpcError } = await supabase
    .rpc("expire_stale_withdrawal_codes");

  if (rpcError) {
    console.error("[process_expired_codes] RPC error:", rpcError);
    return new Response(JSON.stringify({ error: rpcError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Send push notifications for auto-refunded codes
  if (staleCodes?.length) {
    for (const code of staleCodes) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("push_token")
        .eq("id", code.user_id)
        .single()
        .then((__r) => __r, () => ({ data: null }));

      if (profile?.push_token) {
        try {
          await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: profile.push_token,
              title: "Cash code expired — refunded",
              body: `Your cash code ($${(code.amount_cents / 100).toFixed(2)} TTD) expired. The full amount has been refunded to your wallet.`,
              data: { type: "cash_code_expired", code_id: code.id, amount_cents: code.amount_cents },
            }),
          });
        } catch { /* non-fatal */ }
      }
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      expired: expiredCount,
      notified: staleCodes?.length ?? 0,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
