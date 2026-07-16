// Supabase Edge Function: process_pending_wipay_settlements
// Cron worker — runs every 5 minutes.
// Sweeps wipay_sessions with status = 'pending_resolution' where
// pending_since > 5 minutes ago. Queries WiPay for each pending
// transaction. Resolves: marks captured, failed, or force-fails
// after 24 hours with automatic refund attempt.
//
// Self-contained — no _shared/ imports.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WIPAY_API_KEY = Deno.env.get("WIPAY_API_KEY");
const WIPAY_API_URL = Deno.env.get("WIPAY_API_URL") ?? "https://api.wipay.com/v1";
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
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // ── PENDING RESOLUTION SWEEP ─────────────────────────────────
  const { data: pendingSessions, error: fetchError } = await supabase
    .from("wipay_sessions")
    .select("id, order_id, ride_id, transaction_id, amount_cents, created_at, pending_since")
    .eq("status", "pending_resolution")
    .lte("pending_since", fiveMinutesAgo);

  if (fetchError) {
    console.error("[process_pending_wipay_settlements] Fetch error:", fetchError);
    return new Response(JSON.stringify({ error: fetchError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!pendingSessions?.length) {
    return new Response(JSON.stringify({ success: true, processed: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let resolved = 0;
  let forceFailed = 0;

  for (const session of pendingSessions) {
    const isStale = session.pending_since && session.pending_since < twentyFourHoursAgo;
    const ageMinutes = session.pending_since
      ? Math.round((Date.now() - new Date(session.pending_since).getTime()) / 60000)
      : 0;

    // ── FORCE-FAIL after 24h ──────────────────────────────────────
    if (isStale) {
      console.warn(`[process_pending_wipay_settlements] Force-failing stale session ${session.id} (${ageMinutes}m old)`);

      await supabase
        .from("wipay_sessions")
        .update({
          status: "failed",
          error_message: "Force-failed after 24h without resolution",
          resolved_at: new Date().toISOString(),
        })
        .eq("id", session.id)
        .catch(() => {});

      if (session.ride_id) {
        // Attempt refund via wallet credit
        const { data: ride } = await supabase
          .from("rides")
          .select("rider_id, total_fare_cents, payment_method")
          .eq("id", session.ride_id)
          .single()
          .catch(() => ({ data: null }));

        if (ride?.rider_id && ride?.total_fare_cents) {
          await supabase
            .rpc("process_wallet_payment_hardened", {
              p_ride_id: session.ride_id,
              p_amount: -ride.total_fare_cents,
              p_idempotency_key: `wipay_refund_${session.id}`,
            })
            .catch((err) => console.error("Refund failed:", err));

          // Notify rider
          const { data: profile } = await supabase
            .from("profiles")
            .select("push_token")
            .eq("id", ride.rider_id)
            .single()
            .catch(() => ({ data: null }));

          if (profile?.push_token) {
            try {
              await fetch("https://exp.host/--/api/v2/push/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  to: profile.push_token,
                  title: "Payment issue resolved",
                  body: `Your WiPay payment couldn't be processed. It's been refunded to your G-Wallet.`,
                  data: { type: "wipay_refund", ride_id: session.ride_id },
                }),
              });
            } catch { /* non-fatal */ }
          }
        }
      }

      forceFailed++;
      continue;
    }

    // ── QUERY WIPAY TRANSACTION STATUS ────────────────────────────
    if (!WIPAY_API_KEY || !session.transaction_id) {
      // Can't query without API key — leave for next sweep
      console.log(`[process_pending_wipay_settlements] No API key or txn_id for ${session.id} — deferring`);
      continue;
    }

    try {
      const wipayRes = await fetch(`${WIPAY_API_URL}/transaction/${session.transaction_id}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${WIPAY_API_KEY}`,
          "Content-Type": "application/json",
        },
      });

      if (!wipayRes.ok) {
        console.warn(`[process_pending_wipay_settlements] WiPay query returned ${wipayRes.status} for ${session.id}`);
        continue;
      }

      const wipayData = await wipayRes.json();
      const txnStatus = wipayData?.status?.toLowerCase?.() ?? "";

      if (txnStatus === "success" || txnStatus === "completed") {
        if (session.ride_id) {
          await supabase
            .from("rides")
            .update({ payment_status: "captured", wipay_transaction_id: session.transaction_id })
            .eq("id", session.ride_id)
            .catch((err) => console.error("Failed to update ride payment:", err));
        }

        await supabase
          .from("wipay_sessions")
          .update({ status: "completed", resolved_at: new Date().toISOString() })
          .eq("id", session.id);

        resolved++;
      } else if (txnStatus === "cancelled" || txnStatus === "failed") {
        await supabase
          .from("wipay_sessions")
          .update({
            status: "failed",
            error_message: `WiPay confirmed: ${txnStatus}`,
            resolved_at: new Date().toISOString(),
          })
          .eq("id", session.id);

        resolved++;
      } else {
        console.log(`[process_pending_wipay_settlements] ${session.id} still ${txnStatus} — deferring`);
      }
    } catch (err) {
      console.error(`[process_pending_wipay_settlements] Error querying WiPay for ${session.id}:`, err);
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      processed: pendingSessions.length,
      resolved,
      force_failed: forceFailed,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
