// Supabase Edge Function: process_pending_wipay_settlements
// Cron worker — runs every 5 minutes.
// Sweeps wipay_sessions with status = 'pending_resolution' where
// pending_since > 5 minutes ago. Queries WiPay for each pending
// transaction. Resolves: marks captured, failed, or force-fails
// after 24 hours with automatic refund attempt.
//
// Self-contained — no _shared/ imports.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WIPAY_API_KEY = Deno.env.get("WIPAY_API_KEY");
const WIPAY_API_URL = Deno.env.get("WIPAY_API_URL") ?? "https://api.wipay.com/v1";
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
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // ── PENDING RESOLUTION SWEEP ─────────────────────────────────
  // NOTE (register #3): wipay_sessions has NO amount_cents column — selecting
  // it made this sweep's first query fail on every run (430 failed billed
  // calls in six hours, per migration 20260807020000). The amount lives in
  // form_fields.total (dollars, set by create_wipay_payment). Settlement
  // below reads the authoritative fare from the ride row, exactly like
  // wipay_webhook; form_fields is selected only so the amount is available
  // for logging/reconciliation.
  const { data: pendingSessions, error: fetchError } = await supabase
    .from("wipay_sessions")
    .select("id, order_id, ride_id, transaction_id, form_fields, created_at, pending_since")
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
        .then((__r) => __r, () => {});

      if (session.ride_id) {
        // Attempt refund via wallet credit — GUARDED (register #3): never
        // refund a ride whose payment already settled. A session can sit in
        // pending_resolution while the webhook captured and settled the same
        // ride; force-failing that session must not refund on top of the
        // settlement. The stale session row is still marked failed above;
        // only the money movement (and the rider notification) is skipped.
        const { data: ride } = await supabase
          .from("rides")
          .select("rider_id, total_fare_cents, payment_method, payment_status")
          .eq("id", session.ride_id)
          .single()
          .then((__r) => __r, () => ({ data: null }));

        const alreadySettled = ["captured", "confirmed", "receipt_sent"].includes(ride?.payment_status ?? "");
        if (alreadySettled) {
          console.warn(`[process_pending_wipay_settlements] Session ${session.id} force-failed but ride ${session.ride_id} is already ${ride?.payment_status} — refund skipped`);
        }

        if (!alreadySettled && ride?.rider_id && ride?.total_fare_cents) {
          await supabase
            .rpc("process_wallet_payment_hardened", {
              p_ride_id: session.ride_id,
              p_amount: -ride.total_fare_cents,
              p_idempotency_key: `wipay_refund_${session.id}`,
            })
            .then((__r) => __r, (err) => console.error("Refund failed:", err));

          // Notify rider
          const { data: profile } = await supabase
            .from("profiles")
            .select("push_token")
            .eq("id", ride.rider_id)
            .single()
            .then((__r) => __r, () => ({ data: null }));

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
        // SETTLE THE DRIVER (register #3): previously this path marked the
        // ride captured and stopped — rider charged, driver never credited,
        // the exact bug wipay_webhook's ride path was fixed for. Mirror the
        // webhook: same atomic RPC, same idempotency anchor
        // (`wipay_<txnId|orderId>`), so if the webhook also fires for this
        // transaction the settlement lands exactly once.
        let settlementOk = true;

        if (session.ride_id) {
          await supabase
            .from("rides")
            .update({ payment_status: "captured", wipay_transaction_id: session.transaction_id })
            .eq("id", session.ride_id)
            .then((__r) => __r, (err) => console.error("Failed to update ride payment:", err));

          const { data: ride, error: rideErr } = await supabase
            .from("rides")
            .select("id, driver_id, rider_id, total_fare_cents")
            .eq("id", session.ride_id)
            .maybeSingle();

          if (rideErr || !ride) {
            console.error("[process_pending_wipay_settlements] Ride not found for settlement:", session.ride_id, rideErr);
            settlementOk = false;
          } else if (!ride.driver_id) {
            // Grocery/other WiPay flows have no driver — nothing to settle.
            console.log("[process_pending_wipay_settlements] No driver on ride; skipping driver settlement:", session.ride_id);
          } else if ((ride.total_fare_cents ?? 0) <= 0) {
            console.error("[process_pending_wipay_settlements] Refusing to settle a non-positive fare:", session.ride_id);
            settlementOk = false;
          } else {
            const eventId = `wipay_${session.transaction_id || session.order_id}`;
            const { error: settlementError } = await supabase.rpc(
              "process_driver_settlement_atomic",
              {
                p_event_id: eventId,
                p_ride_id: ride.id,
                p_driver_id: ride.driver_id,
                p_rider_id: ride.rider_id,
                p_gross_cents: ride.total_fare_cents,
                p_currency: "TTD",
                p_provider_ref: session.transaction_id || session.order_id,
              },
            );

            if (settlementError) {
              // Money HAS been taken. Do not mark the session resolved —
              // leave it pending_resolution so the next sweep retries the
              // (idempotent) settlement, and raise an alert for manual
              // reconciliation.
              console.error("[process_pending_wipay_settlements] SETTLEMENT FAILED — rider charged, driver unpaid:", {
                ride_id: ride.id, event_id: eventId, error: settlementError.message,
              });
              await supabase
                .from("system_alerts")
                .insert({
                  type: "PAYMENT_ANOMALY",
                  title: "WiPay payment captured but driver settlement failed",
                  severity: "CRITICAL",
                  details: {
                    ride_id: ride.id, order_id: session.order_id, transaction_id: session.transaction_id,
                    gross_cents: ride.total_fare_cents, error: settlementError.message,
                    body: "Rider was charged. Driver was NOT credited. Reconcile manually.",
                  },
                })
                .then((__r) => __r, () => {});
              settlementOk = false;
            }
          }
        }

        if (settlementOk) {
          await supabase
            .from("wipay_sessions")
            .update({ status: "completed", resolved_at: new Date().toISOString() })
            .eq("id", session.id);

          resolved++;
        }
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
