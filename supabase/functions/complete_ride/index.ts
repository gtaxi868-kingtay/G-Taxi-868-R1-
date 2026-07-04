// Supabase Edge Function: complete_ride
// ============================================================
// CAPITAL RESERVE LOCK — Settlement Engine (2026-06-14)
// ============================================================
// Settlement math (server-side only — app is purely display):
//   Business-plan split 82/15/3:
//   platform_fee  = round(gross * platform_rate)  → platform_revenue_logs
//                   platform_rate = pricing_config['PLATFORM_RATE_CENTS']/10000
//                   default 0.15 / loyalty = rate - 0.03 (min 0.01) = 0.12
//   reserve       = round(gross * reserve_rate)   → capital_reserve_ledger
//                   reserve_rate = pricing_config['RESERVE_RATE_CENTS']/10000 (0.03)
//                   Growth Reserve — a THIRD bucket deducted from gross.
//   driver_payout = gross - platform_fee - reserve → wallet / cash  (= 82%)
//   Invariant: platform_fee + reserve + driver_payout = gross
//
// ALL payment paths (wallet, cash, card) converge on this math.
// No client-supplied value is trusted for payout calculation.
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";
import { sendPushNotification } from "../_shared/push.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function getDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function resolveDriverAuthUserId(
  supabaseAdmin: ReturnType<typeof createClient>,
  driverRecord: { user_id?: string } | null,
  driverId: string | null
): Promise<string | null> {
  if (driverRecord?.user_id) return driverRecord.user_id;
  if (!driverId) return null;

  const { data } = await supabaseAdmin
    .from("drivers")
    .select("user_id")
    .eq("id", driverId)
    .maybeSingle();

  return data?.user_id ?? null;
}

const PLATFORM_ACCOUNT = "00000000-0000-0000-0000-000000000000";

/**
 * Server-side settlement calculation — single source of truth.
 * No client-supplied values are used in this computation.
 *
 * Business-plan split 82/15/3:
 *   platformRate: 0.15 standard, 0.12 for loyalty drivers (rate − 0.03).
 *   reserveRate:  0.03 Growth Reserve — a THIRD bucket deducted from gross.
 *   driver_payout = gross − platform_fee − reserve  (= 82%, loyalty 85%).
 *   Invariant: platform_fee + reserve + driver_payout = gross.
 */
function computeSettlement(grossCents: number, platformRate = 0.15, reserveRate = 0.03): {
  reserveCents: number;
  netFare: number;
  platformFee: number;
  driverPayoutCents: number;
  platformRate: number;
} {
  const platformFee = Math.round(grossCents * platformRate);
  const reserveCents = Math.round(grossCents * reserveRate);
  const driverPayoutCents = grossCents - platformFee - reserveCents;
  const netFare = driverPayoutCents;
  return { reserveCents, netFare, platformFee, driverPayoutCents, platformRate };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing authorization", data: null }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid token", data: null }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = user.id;
    const { ride_id, driver_lat, driver_lng } = await req.json();

    if (!ride_id) {
      return new Response(
        JSON.stringify({ success: false, error: "ride_id required", data: null }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: ride, error: rideError } = await supabaseAdmin
      .from("rides")
      .select("*")
      .eq("id", ride_id)
      .single();

    if (rideError || !ride) {
      return new Response(
        JSON.stringify({ success: false, error: "Ride not found", data: null }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (ride.status === "completed") {
      console.log(`Ride ${ride_id} already completed. Returning early.`);
      return new Response(
        JSON.stringify({ success: true, error: null, data: { already_completed: true } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: driverRecord } = await supabaseAdmin
      .from("drivers")
      .select("id, user_id")
      .eq("user_id", userId)
      .maybeSingle();

    const isRider = ride.rider_id === userId;
    const isDriver = driverRecord ? ride.driver_id === driverRecord.id : false;

    if (!isRider && !isDriver) {
      return new Response(
        JSON.stringify({ success: false, error: "Not authorized", data: null }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (ride.status !== "in_progress") {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Ride cannot be completed from status '${ride.status}'. Ride must be 'in_progress'.`,
          data: { current_status: ride.status },
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── STOP COMPLETION CHECK ───────────────────────────────────────────────
    // If rider-initiated with pending stops: block
    // If driver-initiated with pending stops: auto-skip, log event
    // (Runs only after authorization + status checks above — no side effects
    // for an unauthorized or out-of-state caller.)
    const { data: pendingStops } = await supabaseAdmin
      .from("ride_stops")
      .select("id, place_name, stop_order")
      .eq("ride_id", ride_id)
      .in("status", ["pending", "arrived"])
      .order("stop_order", { ascending: true });

    if (pendingStops && pendingStops.length > 0) {
      if (isRider) {
        const stopNames = pendingStops.map((s: any) => s.place_name).join(", ");
        return new Response(
          JSON.stringify({
            success: false,
            error: `Unfinished stops: ${stopNames}. Please skip them first.`,
            data: { pending_stops: pendingStops },
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      // Driver completing — auto-skip pending stops
      const { error: skipErr } = await supabaseAdmin
        .from("ride_stops")
        .update({ status: "skipped" })
        .eq("ride_id", ride_id)
        .in("status", ["pending", "arrived"]);
      if (skipErr) console.error("Failed to auto-skip stops:", skipErr);

      const { error: stopLogErr } = await supabaseAdmin
        .from("ride_events")
        .insert({
          event_type: "stop_skipped",
          ride_id,
          metadata: {
            reason: "ride_completed",
            skipped_stops: pendingStops.map((s: any) => ({ name: s.place_name, id: s.id })),
          },
        });
      if (stopLogErr) console.error("Failed to log stop_skipped event:", stopLogErr);
    }

    if (isDriver) {
      if (!driver_lat || !driver_lng) {
        return new Response(
          JSON.stringify({ success: false, error: "GPS coordinates required to complete ride", data: null }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const distMeters = getDistanceMeters(driver_lat, driver_lng, ride.dropoff_lat, ride.dropoff_lng);

      if (distMeters > 150) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Too far from dropoff. You are ${Math.round(distMeters)}m away (max 150m).`,
            data: { distance: distMeters },
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ── GROSS FARE CALCULATION (server-side, fully) ─────────────────────────
    const STOP_WAIT_FEE_PER_MIN = Deno.env.get("STOP_WAIT_FEE_PER_MIN_CENTS")
        ? parseInt(Deno.env.get("STOP_WAIT_FEE_PER_MIN_CENTS")!) : 150;
    const PICKUP_WAIT_FEE_PER_MIN = 90; // TT$0.90/min after 3-min grace for pickup

    const pickupWaitSec = ride.pickup_wait_seconds || 0;
    const billablePickupSec = Math.max(0, pickupWaitSec - 180);
    const billablePickupFareCents = Math.floor((billablePickupSec / 60) * PICKUP_WAIT_FEE_PER_MIN);

    // Edge Out: TT$1.50/min at merchant pin stops — no grace period
    const stopWaitSec = ride.stop_wait_seconds || 0;
    const billableStopFareCents = Math.floor((stopWaitSec / 60) * STOP_WAIT_FEE_PER_MIN);

    let gridlockSurchargeCents = 0;
    if (ride.duration_seconds && ride.status === "in_progress") {
      const startTime = new Date(ride.updated_at).getTime();
      const now = new Date().getTime();
      const actualDurationSec = (now - startTime) / 1000;
      const delaySec = actualDurationSec - ride.duration_seconds;
      if (delaySec > 900) {
        gridlockSurchargeCents = 1500;
        console.log(`Gridlock detected: Delay of ${Math.round(delaySec / 60)} mins. Surcharge applied.`);
      }
    }

    const totalWaitFareCents = billablePickupFareCents + billableStopFareCents;
    const effectiveFare =
      (ride.total_fare_cents || 0) + totalWaitFareCents + gridlockSurchargeCents;

    // ── PLATFORM + RESERVE RATES FROM CONFIG ──────────────────────────────────
    // Business-plan split 82/15/3. Admin can change without redeploy.
    // Falls back to 0.15 platform / 0.03 reserve if table is empty/unreachable.
    const { data: platRateRow } = await supabaseAdmin
      .from("pricing_config")
      .select("value_cents")
      .eq("key", "PLATFORM_RATE_CENTS")
      .maybeSingle()
      .catch(() => ({ data: null }));
    const defaultPlatformRate = platRateRow ? (platRateRow.value_cents ?? 1500) / 10000 : 0.15;

    const { data: reserveRateRow } = await supabaseAdmin
      .from("pricing_config")
      .select("value_cents")
      .eq("key", "RESERVE_RATE_CENTS")
      .maybeSingle()
      .catch(() => ({ data: null }));
    const reserveRate = reserveRateRow ? (reserveRateRow.value_cents ?? 300) / 10000 : 0.03;

    // ── LOYALTY RATE TIER ───────────────────────────────────────────────────
    // Drivers with wallet balance ≥ TTD $500 get 12% instead of 15%.
    const driverUserIdForLoyalty = await resolveDriverAuthUserId(supabaseAdmin, driverRecord, ride.driver_id);
    let platformRate = defaultPlatformRate;
    let loyaltyApplied = false;

    if (driverUserIdForLoyalty) {
      const { data: qualifies } = await supabaseAdmin
        .rpc("driver_qualifies_loyalty_rate", { p_driver_user_id: driverUserIdForLoyalty })
        .catch(() => ({ data: false }));

      if (qualifies === true) {
        // Read loyalty rate from pricing_config (value_cents = percentage, e.g. 16 = 16%)
        const { data: loyaltyRow } = await supabaseAdmin
            .from("pricing_config")
            .select("value_cents")
            .eq("key", "LOYALTY_FEE_PCT")
            .maybeSingle()
            .catch(() => ({ data: null }));
        const loyaltyRate = loyaltyRow ? (loyaltyRow.value_cents ?? 12) / 100 : Math.max(0.01, defaultPlatformRate - 0.03);
        platformRate = Math.max(0.01, Math.min(defaultPlatformRate, loyaltyRate));
        loyaltyApplied = true;
        console.log(`[LOYALTY_TIER] Driver ${driverUserIdForLoyalty} qualifies — 12% rate applied`);

        // Notify driver on first qualification
        if (driverRecord && (driverRecord as any).push_token && !(driverRecord as any).loyalty_tier_notified) {
          sendPushNotification(
            (driverRecord as any).push_token,
            '🏆 Driver Loyalty Tier Unlocked',
            'Your wallet balance qualifies you for a reduced 12% platform fee! You\'re saving money on every ride.',
            { type: 'LOYALTY_TIER_UNLOCKED' }
          ).catch((err: unknown) => console.error('Loyalty notification failed:', err));
          await supabaseAdmin
            .from('drivers')
            .update({ loyalty_tier_notified: true })
            .eq('id', driverRecord.id)
            .catch((err: unknown) => console.error('Failed to set loyalty_tier_notified:', err));
        }
      }
    }

    // ── SETTLEMENT MATH (single source of truth — server only) ──────────────
    const { reserveCents, platformFee, driverPayoutCents } = computeSettlement(effectiveFare, platformRate, reserveRate);

    // ── PAYMENT PROCESSING ──────────────────────────────────────────────────
    if (ride.payment_method === "wallet" && ride.payment_status !== "captured") {
      const { data: walletSuccess, error: payError } = await supabaseAdmin.rpc(
        "process_wallet_payment_hardened",
        { p_ride_id: ride_id, p_amount: effectiveFare, p_idempotency_key: `complete_ride_${ride_id}` }
      );

      if (payError || !walletSuccess) {
        console.error("Wallet payment failed:", payError);
        return new Response(
          JSON.stringify({ success: false, error: "Payment failed: Insufficient wallet funds", data: { required: effectiveFare } }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else if (ride.payment_method === "cash") {
      // ── CASH PATH: Shadow ledger with settlement math ──────────────────────
      const { error: cashError } = await supabaseAdmin
        .from("rides")
        .update({ cash_confirmed: true })
        .eq("id", ride_id)
        .eq("status", "in_progress");

      if (cashError) {
        console.error("Failed to confirm cash payment:", cashError);
        return new Response(
          JSON.stringify({ success: false, error: "Failed to confirm cash payment", data: null }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const driverUserId = driverUserIdForLoyalty ?? await resolveDriverAuthUserId(supabaseAdmin, driverRecord, ride.driver_id);

      if (!driverUserId) {
        console.error("Cash settlement: could not resolve driver auth user_id", { ride_id, driver_id: ride.driver_id });
        return new Response(
          JSON.stringify({ success: false, error: "Driver account not found for settlement", data: null }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const totalPlatformCents = platformFee;

      console.log("[SHADOW_LEDGER][completeRide]", {
        ride_id,
        gross_cents: effectiveFare,
        reserve_cents: reserveCents,
        platform_fee: platformFee,
        driver_payout: driverPayoutCents,
        platform_rate: platformRate,
        loyalty_applied: loyaltyApplied,
        payment_method: "cash",
        driver_user_id: driverUserId,
      });

      await supabaseAdmin.rpc("deduct_driver_commission_hardened", {
        p_driver_user_id: driverUserId,
        p_ride_id: ride_id,
        p_amount_cents: totalPlatformCents,
        p_description: `Platform (${(platformRate * 100).toFixed(1)}%${loyaltyApplied ? " loyalty" : ""}) on cash ride — growth reserve (3%) settled separately`
      }).catch((err) => console.error("deduct_driver_commission_hardened failed:", err));

      await supabaseAdmin.rpc("post_reserve_contribution", {
        p_source_id: ride_id,
        p_amount_cents: reserveCents,
        p_source_type: "ride",
      }).catch((err) => console.error("post_reserve_contribution (cash) failed:", err));

      await supabaseAdmin.from("payment_ledger").insert({
        ride_id: ride_id,
        user_id: ride.rider_id,
        amount: effectiveFare / 100,
        currency: "TTD",
        status: "captured",
        provider: "cash",
      }).catch((err) => console.error("Cash payment_ledger insert failed:", err));

    } else if (ride.payment_method === "card" || ride.payment_method === "wipay") {
      if (ride.payment_status !== "captured") {
        return new Response(
          JSON.stringify({
            success: false,
            error: (ride.payment_method === "card" ? "Card" : "WiPay") + " payment has not been captured yet.",
            data: { payment_status: ride.payment_status },
          }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ── UPDATE RIDE RECORD (atomic guard) ─────────────────────────────────
    // total_fare_cents updated to effectiveFare (includes wait/gridlock)
    // so trigger tr_ensure_fare_waterfall recalculates 82/15/3 splits.
    const { error: updateError, count } = await supabaseAdmin
      .from("rides")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        total_fare_cents: effectiveFare,
      }, { count: "exact" })
      .eq("id", ride_id)
      .in("status", ["in_progress"]);

    if (updateError || count === 0) {
      console.error("Ride status update failed — reversing payment mutations:", updateError);

      if (ride.payment_method === "wallet" && ride.payment_status !== "captured") {
        await supabaseAdmin
          .from("wallet_transactions")
          .insert({
            user_id: ride.rider_id,
            ride_id: ride_id,
            amount: effectiveFare,
            transaction_type: "reversal",
            description: `COMPENSATING REVERSAL: ride ${ride_id} status update failed after wallet debit`,
            status: "completed",
          })
          .catch((err) => console.error("Compensating reversal also failed:", err));
      } else if (ride.payment_method === "cash") {
        await supabaseAdmin
          .from("wallet_transactions")
          .delete()
          .eq("ride_id", ride_id)
          .eq("transaction_type", "commission_fee")
          .catch((err) => console.error("Cash reversal: wallet_txn delete failed:", err));
        await supabaseAdmin
          .from("capital_reserve_ledger")
          .delete()
          .eq("ride_id", ride_id)
          .eq("status", "locked")
          .catch((err) => console.error("Cash reversal: reserve delete failed:", err));
        await supabaseAdmin
          .from("payment_ledger")
          .delete()
          .eq("ride_id", ride_id)
          .eq("provider", "cash")
          .catch((err) => console.error("Cash reversal: payment_ledger delete failed:", err));
      }

      return new Response(
        JSON.stringify({ success: false, error: "Failed to complete ride: status unexpectedly changed", data: null }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── LOG PLATFORM REVENUE (with reserve separation) ─────────────────────
    const ledgerMerchantId = ride.billed_to_merchant_id || ride.merchant_id || null;

    await supabaseAdmin
      .rpc("log_platform_revenue", {
        p_ride_id: ride_id,
        p_order_id: ride.order_id || null,
        p_merchant_id: ledgerMerchantId,
        p_gross_cents: effectiveFare,
        p_payout_cents: driverPayoutCents,
        p_merchant_earnings_cents: 0,
        p_reserve_cents: reserveCents,
      })
      .catch((err) => console.error("Ledger logging failed:", err));

    // ── ASYNC ECOSYSTEM COG ───────────────────────────────────────────────────
    // Enqueue ride.completed off the hot path. The cron'd process_event_queue
    // worker picks it up → record_pool_entry (17% waterfall) + seed_zone for any
    // dropoff outside an active zone. Non-fatal: never blocks ride completion.
    await supabaseAdmin
      .from("event_queue")
      .insert({
        event_type: "ride.completed",
        payload: {
          ride_id: ride_id,
          pickup_lat: ride.pickup_lat,
          pickup_lng: ride.pickup_lng,
          dropoff_lat: ride.dropoff_lat,
          dropoff_lng: ride.dropoff_lng,
          gross_cents: effectiveFare,
          platform_cents: platformFee,
          reserve_cents: reserveCents,
        },
      })
      .catch((err) => console.error("event_queue enqueue (ride.completed) failed:", err));

    // ── VENDOR COMMISSION (5% to kiosk merchant when ride from a node) ─────────
    // Vendor 5% comes FROM the platform's 15% cut — not added on top.
    // Net platform on merchant rides = 15% - 5% = 10%.
    // Per-kiosk dispatch_premium_pct controls the fare uplift applied at estimate_fare.
    if (ride.vendor_node_id) {
      try {
        const { data: kiosk } = await supabaseAdmin
          .from("kiosk_nodes")
          .select("id, merchant_id, staff_member_id, dispatch_premium_pct")
          .eq("id", ride.vendor_node_id)
          .single();

        if (kiosk) {
          const { data: merchant } = await supabaseAdmin
            .from("merchants")
            .select("commission_rate")
            .eq("id", kiosk.merchant_id)
            .single();

          const rate = merchant?.commission_rate ?? 0.05;
          const commissionCents = Math.floor(effectiveFare * rate);
          // Staff earn 1% of ride fare (sub-commission under the merchant's umbrella)
          const staffAmountCents = kiosk.staff_member_id
            ? Math.floor(effectiveFare * 0.01)
            : 0;

          await supabaseAdmin.from("vendor_commissions").insert({
            ride_id: ride_id,
            kiosk_node_id: kiosk.id,
            merchant_id: kiosk.merchant_id,
            staff_member_id: kiosk.staff_member_id || null,
            commission_rate: rate,
            commission_cents: commissionCents,
            status: "pending",
          });

          // Credit merchant + staff wallets immediately
          await supabaseAdmin
            .rpc("credit_merchant_commission", {
              p_merchant_id: kiosk.merchant_id,
              p_ride_id: ride_id,
              p_amount_cents: commissionCents,
              p_staff_member_id: kiosk.staff_member_id || null,
              p_staff_amount_cents: staffAmountCents,
            })
            .catch((err) => console.error("Merchant/staff wallet credit failed (non-fatal):", err));
        }
      } catch (err) {
        console.error("Vendor commission recording failed (non-fatal):", err);
      }
    }

    // ── ARRIVAL TAX — Pin Fee (usage-based) ──────────────────────────────
    // If a pinned merchant received a rider, log an arrival event.
    // The cron'd charge_merchant_pin_fees worker aggregates pending events
    // and deducts from the merchant's wallet. Non-fatal.
    if (ride.billed_to_merchant_id || ride.merchant_id) {
      const merchantId = ride.billed_to_merchant_id || ride.merchant_id;

      const { data: merchant } = await supabaseAdmin
        .from("merchants")
        .select("is_pinned")
        .eq("id", merchantId)
        .maybeSingle()
        .catch(() => ({ data: null }));

      if (merchant?.is_pinned) {
        const { data: subscription } = await supabaseAdmin
          .from("merchant_subscriptions")
          .select("pin_fee_cents")
          .eq("merchant_id", merchantId)
          .maybeSingle()
          .catch(() => ({ data: null }));

        if (subscription && (subscription.pin_fee_cents || 0) > 0) {
          await supabaseAdmin
            .from("arrival_events")
            .insert({
              ride_id: ride_id,
              merchant_id: merchantId,
              arrival_type: "dropoff",
              pin_fee_cents: subscription.pin_fee_cents,
            })
            .catch((err) => console.error("arrival_events insert failed (non-fatal):", err));
        }
      }
    }

    // ── DRIVER REFERRAL COMMISSION (1% of platform fee to referrer for 90 days) ─
    if (driverUserIdForLoyalty && platformFee > 0) {
      await supabaseAdmin
        .rpc("check_driver_referral_commission", {
          p_driver_user_id: driverUserIdForLoyalty,
          p_ride_id: ride_id,
          p_platform_fee_cents: platformFee,
        })
        .catch((err) => console.error("Driver referral commission failed (non-fatal):", err));
    }

    // ── DRIVER LOAN REPAYMENT ─────────────────────────────────────────────
    if (ride.driver_id) {
      await supabaseAdmin
        .rpc("deduct_loan_installment", { p_driver_id: ride.driver_id, p_ride_id: ride_id })
        .catch((err) => console.error("Loan deduction failed (non-fatal):", err));
    }

    // ── FLEET LEASE DEDUCTION ─────────────────────────────────────────────
    let leaseDeductionCents = 0;
    let leaseDeductionStatus: "none" | "deducted" | "insufficient_balance" = "none";

    if (ride.driver_id) {
      const { data: leaseResult } = await supabaseAdmin
        .rpc("deduct_lease_installment_for_ride", { p_ride_id: ride_id })
        .catch((err) => {
          console.error("Lease deduction failed (non-blocking):", err);
          return { data: null };
        });

      if (leaseResult && leaseResult.length > 0) {
        const lr = leaseResult[0];
        if (lr.success && lr.deduction_cents > 0) {
          leaseDeductionCents = lr.deduction_cents;
          leaseDeductionStatus = "deducted";
          console.log(`[LEASE_DEDUCTION] Deducted ${lr.deduction_cents} cents for ride ${ride_id}`);

          await supabaseAdmin
            .from("platform_revenue_logs")
            .update({ lease_deduction_cents: lr.deduction_cents })
            .eq("ride_id", ride_id)
            .catch((err) => console.error("Failed to update revenue log lease deduction:", err));
        } else if (lr.deduction_cents > 0 && !lr.success) {
          leaseDeductionStatus = "insufficient_balance";
          console.warn(`[LEASE_DEDUCTION] Failed for ride ${ride_id}: ${lr.error_message}`);
        }
      }
    }

    // ── PUSH NOTIFICATION ──────────────────────────────────────────────────
    if (ride.rider_id) {
      const { data: riderProfile } = await supabaseAdmin
        .from("profiles")
        .select("push_token")
        .eq("id", ride.rider_id)
        .single();

      if (riderProfile?.push_token) {
        sendPushNotification(
          riderProfile.push_token,
          "Ride Completed",
          `Your ride is finished. Final fare: $${(effectiveFare / 100).toFixed(2)} TTD.`,
          { type: "RIDE_COMPLETED", ride_id: ride.id }
        ).catch((err) => console.error("Rider push failed:", err));
      }
    }

    // ── PROGRESSION: record activity + check level-up (non-blocking) ─────────
    if (ride.rider_id) {
      supabaseAdmin
        .rpc("record_rider_activity", {
          p_rider_id: ride.rider_id,
          p_event_type: "ride_completed",
          p_amount_cents: effectiveFare,
          p_ride_id: ride_id,
          p_metadata: { fare_cents: effectiveFare, payment_method: ride.payment_method },
        })
        .then(async ({ data }) => {
          const result = Array.isArray(data) ? data[0] : data;
          if (result?.leveled_up && result?.new_unlock) {
            const { data: profile } = await supabaseAdmin
              .from("profiles")
              .select("push_token")
              .eq("id", ride.rider_id)
              .single()
              .catch(() => ({ data: null }));
            const { data: levelCfg } = await supabaseAdmin
              .from("progression_config")
              .select("push_title, push_body")
              .eq("level", result.level_after)
              .single()
              .catch(() => ({ data: null }));
            if (profile?.push_token && levelCfg) {
              sendPushNotification(
                profile.push_token,
                levelCfg.push_title,
                levelCfg.push_body,
                { type: "LEVEL_UP", level: result.level_after, unlock: result.new_unlock }
              ).catch(() => {});
            }
          }
        })
        .catch((err) => console.error("record_rider_activity failed (non-fatal):", err));
    }

    // ── BAND REVSHARE: if ride was tagged with a carnival band (non-blocking) ─
    if (ride.metadata?.band_id) {
      const bandId = ride.metadata.band_id;
      const eventId = ride.metadata.carnival_event_id || null;

      const { data: bandInfo } = await supabaseAdmin
        .from('carnival_bands')
        .select('revshare_percent')
        .eq('id', bandId)
        .maybeSingle()
        .catch(() => ({ data: null }));

      const effectivePct = bandInfo?.revshare_percent ?? 5;
      const revshareCents = Math.floor(effectiveFare * (effectivePct / 100));

      if (revshareCents > 0) {
        await supabaseAdmin
          .from('band_revshare_ledger')
          .insert({
            ride_id: ride_id,
            band_id: bandId,
            event_id: eventId,
            rider_id: ride.rider_id,
            fare_cents: effectiveFare,
            revshare_cents: revshareCents,
            status: 'pending',
          })
          .catch((err) => console.error('Band revshare insert failed (non-fatal):', err));
      }
    }

    // ── EVENT REVSHARE: if ride was tagged with a general event organizer ─────
    if (ride.metadata?.organizer_id) {
      const organizerId = ride.metadata.organizer_id;
      const sourceEventId = ride.metadata.event_id || null;

      const { data: orgInfo } = await supabaseAdmin
        .from('event_organizers')
        .select('revshare_percent')
        .eq('id', organizerId)
        .maybeSingle()
        .catch(() => ({ data: null }));

      const effectivePct = orgInfo?.revshare_percent ?? 5;
      const revshareCents = Math.floor(effectiveFare * (effectivePct / 100));

      if (revshareCents > 0) {
        await supabaseAdmin
          .from('event_revshare_ledger')
          .insert({
            ride_id: ride_id,
            organizer_id: organizerId,
            event_id: sourceEventId,
            rider_id: ride.rider_id,
            fare_cents: effectiveFare,
            revshare_cents: revshareCents,
            status: 'pending',
          })
          .catch((err) => console.error('Event revshare insert failed (non-fatal):', err));
      }
    }

    // ── COMMANDER REVSHARE: rider recruited by a commander (non-blocking) ─────
    // Carved FROM the platform's 15% — the 82/15/3 split above is untouched.
    // Net platform on commander-attributed rides = 15% − 3% = 12%.
    {
      const { data: riderRef } = await supabaseAdmin
        .from("profiles")
        .select("referred_by_commander_id")
        .eq("id", ride.rider_id)
        .maybeSingle()
        .catch(() => ({ data: null }));

      const commanderId = riderRef?.referred_by_commander_id;
      if (commanderId) {
        const { data: cmdRateRow } = await supabaseAdmin
          .from("pricing_config")
          .select("value_cents")
          .eq("key", "COMMANDER_REVSHARE_RATE_CENTS")
          .maybeSingle()
          .catch(() => ({ data: null }));
        const commanderRate = cmdRateRow?.value_cents ? cmdRateRow.value_cents / 10000 : 0.03;
        const commanderCents = Math.floor(effectiveFare * commanderRate);

        if (commanderCents > 0) {
          await supabaseAdmin
            .from("commander_revshare_ledger")
            .insert({
              ride_id: ride_id,
              commander_id: commanderId,
              rider_id: ride.rider_id,
              fare_cents: effectiveFare,
              revshare_cents: commanderCents,
              status: "pending",
            })
            .catch((err) => console.error("Commander revshare insert failed (non-fatal):", err));
        }
      }
    }

    // ── DRIVER LEASE ELIGIBILITY: refresh active-day count (non-blocking) ────
    if (ride.driver_id) {
      supabaseAdmin
        .rpc("refresh_driver_lease_eligibility", { p_driver_id: ride.driver_id })
        .then(async ({ data }) => {
          const result = Array.isArray(data) ? data[0] : data;
          if (result?.newly_qualified) {
            const { data: driverUser } = await supabaseAdmin
              .from("drivers")
              .select("user_id")
              .eq("id", ride.driver_id)
              .single()
              .catch(() => ({ data: null }));
            if (driverUser?.user_id) {
              const { data: driverProfile } = await supabaseAdmin
                .from("profiles")
                .select("push_token")
                .eq("id", driverUser.user_id)
                .single()
                .catch(() => ({ data: null }));
              if (driverProfile?.push_token) {
                sendPushNotification(
                  driverProfile.push_token,
                  "BYD Lease Unlocked",
                  "You've driven 90 active days. You now qualify for a G-Taxi BYD lease. Check your app to apply.",
                  { type: "LEASE_ELIGIBLE" }
                ).catch(() => {});
              }
            }
          }
        })
        .catch((err) => console.error("refresh_driver_lease_eligibility failed (non-fatal):", err));
    }

    // P3.2: Enqueue ride.completed event for pool ledger + cog processing
    supabaseAdmin
      .rpc("enqueue_event", {
        p_event_type: "ride.completed",
        p_payload: {
          ride_id,
          pickup_lat: ride.pickup_lat,
          pickup_lng: ride.pickup_lng,
          dropoff_lat: ride.dropoff_lat,
          dropoff_lng: ride.dropoff_lng,
          gross_cents: effectiveFare,
          platform_cents: platformFee,
          reserve_cents: reserveCents,
        },
      })
      .then(() => console.log(`Event enqueued: ride.completed for ${ride_id}`))
      .catch((err) => console.error("Failed to enqueue event:", err));

    return new Response(
      JSON.stringify({
        success: true,
        error: null,
        data: {
          ride_id,
          status: "completed",
          total_fare_cents: effectiveFare,
          settlement: {
            reserve_cents: reserveCents,
            platform_fee_cents: platformFee,
            driver_payout_cents: driverPayoutCents,
            driver_net_payout_cents: driverPayoutCents - leaseDeductionCents,
            lease_deduction_cents: leaseDeductionCents,
            lease_status: leaseDeductionStatus,
            platform_rate: platformRate,
            loyalty_rate_applied: loyaltyApplied,
          },
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("complete_ride error:", error);
    await captureException(error, { function: "complete_ride" });
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error", data: null }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
