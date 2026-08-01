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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
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
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
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

  return (data?.user_id as string | undefined) ?? null;
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

    // ── ESCROW-PREPAID G-ESCAPE GROUND TRANSFER ─────────────────────────────
    // These rides are created by execute_escape_group_confirmation() for
    // G-Escape airport/villa ground transfers (outbound and return) — the
    // fare was already reserved from the rider's payment at booking
    // confirmation (transit_financial_ledger). Completing one pays the
    // driver the FULL fare from that reserve — there's no rider to debit
    // here, and no separate platform/commander split (the platform already
    // took its margin at confirmation). Short-circuits before any of the
    // normal wallet/cash/card fare logic below, but after the same GPS
    // proximity check every other ride completion requires.
    if (ride.payment_method === "escrow_prepaid") {
      const driverAuthUserId = await resolveDriverAuthUserId(supabaseAdmin, driverRecord, ride.driver_id);
      if (!driverAuthUserId) {
        return new Response(
          JSON.stringify({ success: false, error: "No driver assigned to this transfer ride", data: null }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error: escrowUpdateError, count: escrowCount } = await supabaseAdmin
        .from("rides")
        .update({ status: "completed", completed_at: new Date().toISOString(), payment_status: "confirmed" }, { count: "exact" })
        .eq("id", ride_id)
        .in("status", ["in_progress"]);

      if (escrowUpdateError || escrowCount === 0) {
        return new Response(
          JSON.stringify({ success: false, error: "Failed to complete transfer ride: status unexpectedly changed", data: null }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const fareCents = ride.total_fare_cents || 0;
      if (fareCents > 0) {
        await supabaseAdmin.from("wallet_transactions").insert({
          user_id: driverAuthUserId,
          ride_id: ride_id,
          amount: fareCents,
          transaction_type: "driver_payout",
          description: "G-Escape ground transfer payout (from escrow)",
          status: "completed",
        }).then((res) => res, (err: unknown) => console.error("Escrow driver payout insert failed:", err));
      }

      // package_reservations links this ride via exactly one of its four
      // transfer_ride_id columns — mark the matching escrow ledger leg
      // executed. Note: each side (trinidad_driver / tobago_driver) is one
      // ledger row covering BOTH legs on that side (outbound + return), so
      // this marks it executed on the first of the two completions — the
      // real wallet_transactions payout below is still exact per-leg; only
      // the ledger's "fully settled" marker is granular to the pair, not
      // the individual ride.
      const { data: matchedReservation } = await supabaseAdmin
        .from("package_reservations")
        .select("id, trinidad_transfer_ride_id, destination_transfer_ride_id, trinidad_return_ride_id, destination_return_ride_id")
        .or(`trinidad_transfer_ride_id.eq.${ride_id},destination_transfer_ride_id.eq.${ride_id},trinidad_return_ride_id.eq.${ride_id},destination_return_ride_id.eq.${ride_id}`)
        .maybeSingle();

      if (matchedReservation) {
        const isTrinidadLeg = matchedReservation.trinidad_transfer_ride_id === ride_id || matchedReservation.trinidad_return_ride_id === ride_id;
        const legParty = isTrinidadLeg ? "trinidad_driver" : "tobago_driver";
        await supabaseAdmin
          .from("transit_financial_ledger")
          .update({ executed_at: new Date().toISOString() })
          .eq("reservation_id", matchedReservation.id)
          .eq("destination_party", legParty)
          .is("executed_at", null)
          .then((res) => res, (err: unknown) => console.error("Escrow ledger mark-executed failed:", err));
      }

      return new Response(
        JSON.stringify({ success: true, error: null, data: { escrow_payout_cents: fareCents, driver_paid: true } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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

    // ── RIDER LOYALTY DISCOUNT (wallet only, for now) ───────────────────────
    // progression_config.discount_percent has existed since the level ladder
    // shipped but was never actually subtracted from any real fare — riders
    // were shown "12% off" perks that were 100% decorative. Wired for real
    // here, wallet-only: cash/card require a client-side fare-display change
    // (the rider needs to see the discounted amount before paying) that's out
    // of scope for this pass. compute_ride_split absorbs the discount ENTIRELY
    // from the platform's own cut — driver_net, commander_cut, and reserve are
    // never touched, verified in a rolled-back dry run before this shipped.
    //
    // G-Member is gated behind profiles.g_member_active, which is false
    // everywhere today (join is still a waitlist per the 2026-07-16
    // giveaway-hole fix — no billing exists to ever set it true). This is
    // built now, ahead of billing, so the economics are already correct the
    // moment a future billing webhook flips the flag: 15% off is capped at
    // the rider's first 6 completed wallet rides each calendar month — past
    // the cap, falls back to their earned Level discount. Without a cap, a
    // moderately active rider (15-20 rides/month) costs the platform more in
    // discount than the TT$60/mo subscription collects — the exact leak this
    // cap exists to close. compute_ride_split still absorbs whatever discount
    // applies entirely from the platform's own cut — driver_net, commander_
    // cut, and reserve are never touched regardless of which rate is used.
    let riderDiscountCents = 0;
    if (ride.rider_id && ride.payment_method === "wallet") {
      const { data: prog } = await supabaseAdmin
        .from("rider_progression")
        .select("level")
        .eq("rider_id", ride.rider_id)
        .maybeSingle()
        .then((res) => res, () => ({ data: null }));
      if (prog?.level && prog.level >= 2) {
        const { data: levelCfg } = await supabaseAdmin
          .from("progression_config")
          .select("discount_percent")
          .eq("level", prog.level)
          .maybeSingle()
          .then((res) => res, () => ({ data: null }));
        let discountPct: number = levelCfg?.discount_percent || 0;

        if (prog.level >= 5) {
          const { data: profileRow } = await supabaseAdmin
            .from("profiles")
            .select("g_member_active")
            .eq("id", ride.rider_id)
            .maybeSingle()
            .then((res) => res, () => ({ data: null }));
          if (profileRow?.g_member_active) {
            const monthStart = new Date();
            monthStart.setUTCDate(1);
            monthStart.setUTCHours(0, 0, 0, 0);
            const { count } = await supabaseAdmin
              .from("rides")
              .select("id", { count: "exact", head: true })
              .eq("rider_id", ride.rider_id)
              .eq("payment_method", "wallet")
              .eq("status", "completed")
              .gte("completed_at", monthStart.toISOString())
              .then((res) => res, () => ({ count: 0 }));
            if ((count ?? 0) < 6) {
              discountPct = 15;
            }
          }
        }

        if (discountPct) {
          riderDiscountCents = Math.floor(effectiveFare * discountPct / 100);
        }
      }
    }

    // ── PLATFORM + RESERVE RATES FROM CONFIG ──────────────────────────────────
    // Business-plan split 82/15/3. Admin can change without redeploy.
    // Falls back to 0.15 platform / 0.03 reserve if table is empty/unreachable.
    const { data: platRateRow } = await supabaseAdmin
      .from("pricing_config")
      .select("value_cents")
      .eq("key", "PLATFORM_RATE_CENTS")
      .maybeSingle()
      .then((res) => res, () => ({ data: null }));
    const defaultPlatformRate = platRateRow ? (platRateRow.value_cents ?? 1500) / 10000 : 0.15;

    const { data: reserveRateRow } = await supabaseAdmin
      .from("pricing_config")
      .select("value_cents")
      .eq("key", "RESERVE_RATE_CENTS")
      .maybeSingle()
      .then((res) => res, () => ({ data: null }));
    const reserveRate = reserveRateRow ? (reserveRateRow.value_cents ?? 300) / 10000 : 0.03;

    // ── LOYALTY RATE TIER ───────────────────────────────────────────────────
    // Drivers with wallet balance ≥ TTD $500 get 12% instead of 15%.
    const driverUserIdForLoyalty = await resolveDriverAuthUserId(supabaseAdmin, driverRecord, ride.driver_id);
    let platformRate = defaultPlatformRate;
    let loyaltyApplied = false;

    if (driverUserIdForLoyalty) {
      const { data: qualifies } = await supabaseAdmin
        .rpc("driver_qualifies_loyalty_rate", { p_driver_user_id: driverUserIdForLoyalty })
        .then((res) => res, () => ({ data: false }));

      if (qualifies === true) {
        // Read loyalty rate from pricing_config (value_cents = percentage, e.g. 16 = 16%)
        const { data: loyaltyRow } = await supabaseAdmin
            .from("pricing_config")
            .select("value_cents")
            .eq("key", "LOYALTY_FEE_PCT")
            .maybeSingle()
            .then((res) => res, () => ({ data: null }));
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
          ).then((res) => res, (err: unknown) => console.error('Loyalty notification failed:', err));
          await supabaseAdmin
            .from('drivers')
            .update({ loyalty_tier_notified: true })
            .eq('id', driverRecord.id)
            .then((res) => res, (err: unknown) => console.error('Failed to set loyalty_tier_notified:', err));
        }
      }
    }

    // ── SETTLEMENT MATH (single source of truth — server only) ──────────────
    const { reserveCents, platformFee, driverPayoutCents } = computeSettlement(effectiveFare, platformRate, reserveRate);

    // ── PAYMENT PROCESSING ──────────────────────────────────────────────────
    if (ride.payment_method === "wallet" && ride.payment_status !== "captured") {
      const { data: walletSuccess, error: payError } = await supabaseAdmin.rpc(
        "process_wallet_payment_hardened",
        {
          p_ride_id: ride_id,
          p_amount: effectiveFare,
          p_idempotency_key: `complete_ride_${ride_id}`,
          p_discount_cents: riderDiscountCents,
        }
      );

      // process_wallet_payment_hardened RETURNS TABLE(...), so PostgREST
      // hands back an ARRAY of rows. `!walletSuccess` was therefore false
      // even for a declined payment — a non-empty array is truthy — which
      // would have marked the ride paid while no money moved. The verdict
      // lives in the row's `success` field and nowhere else.
      const walletRow = Array.isArray(walletSuccess) ? walletSuccess[0] : walletSuccess;

      if (payError || walletRow?.success !== true) {
        // Report the REAL reason. Previously this always claimed
        // "Insufficient wallet funds", which sent people debugging
        // balances when the actual cause was a bad function signature.
        const reason =
          payError?.message ??
          walletRow?.error_message ??
          "Wallet payment could not be completed";

        console.error("Wallet payment failed:", { ride_id, reason, payError, walletRow });

        // 409 for "retry won't help / state conflict", 402 only when the
        // rider genuinely has to top up.
        const isFunds = typeof reason === "string" && reason.toLowerCase().includes("insufficient");
        return new Response(
          JSON.stringify({
            success: false,
            error: isFunds ? `Payment failed: ${reason}` : `Payment failed: ${reason}`,
            data: { required: effectiveFare, retryable: !isFunds },
          }),
          { status: isFunds ? 402 : 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else if (ride.payment_method === "cash") {
      // ── CASH PATH: driver-debt settlement via the single settlement source ──
      // settle_cash_ride runs compute_ride_split, records the driver's
      // commission_debt + commander/merchant kickbacks, and marks the ride
      // confirmed. (Was just setting cash_confirmed=true, which collected
      // nothing and no-op'd the driver's later confirm_cash_payment.)
      const { data: cashSettled, error: cashError } = await supabaseAdmin
        .rpc("settle_cash_ride", { p_ride_id: ride_id });

      if (cashError || !cashSettled) {
        console.error("Failed to settle cash payment:", cashError);
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

      // NOTE: settle_cash_ride above already booked the driver's FULL
      // obligation (platform fee + reserve + commander/vendor kickbacks) as a
      // single commission_debt wallet transaction via compute_ride_split.
      // The deduct_driver_commission_hardened + post_reserve_contribution
      // calls that used to run here charged the driver a SECOND time
      // (~38% total instead of ~20%) — removed 2026-07-16.

      await supabaseAdmin.from("payment_ledger").insert({
        ride_id: ride_id,
        user_id: ride.rider_id,
        amount: effectiveFare / 100,
        currency: "TTD",
        status: "captured",
        provider: "cash",
      }).then((res) => res, (err: unknown) => console.error("Cash payment_ledger insert failed:", err));

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
          .then((res) => res, (err: unknown) => console.error("Compensating reversal also failed:", err));
      } else if (ride.payment_method === "cash") {
        // settle_cash_ride booked the obligation as commission_debt and set
        // cash_confirmed — undo both so a retried completion re-settles.
        await supabaseAdmin
          .from("wallet_transactions")
          .delete()
          .eq("ride_id", ride_id)
          .in("transaction_type", ["commission_fee", "commission_debt"])
          .then((res) => res, (err: unknown) => console.error("Cash reversal: wallet_txn delete failed:", err));
        await supabaseAdmin
          .from("rides")
          .update({ cash_confirmed: false, payment_status: "pending" })
          .eq("id", ride_id)
          .then((res) => res, (err: unknown) => console.error("Cash reversal: cash_confirmed reset failed:", err));
        await supabaseAdmin
          .from("capital_reserve_ledger")
          .delete()
          .eq("ride_id", ride_id)
          .eq("status", "locked")
          .then((res) => res, (err: unknown) => console.error("Cash reversal: reserve delete failed:", err));
        await supabaseAdmin
          .from("payment_ledger")
          .delete()
          .eq("ride_id", ride_id)
          .eq("provider", "cash")
          .then((res) => res, (err: unknown) => console.error("Cash reversal: payment_ledger delete failed:", err));
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
      .then((res) => res, (err: unknown) => console.error("Ledger logging failed:", err));

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
      .then((res) => res, (err: unknown) => console.error("event_queue enqueue (ride.completed) failed:", err));

    // ── NODE "RENT" (2% of the PLATFORM'S take when ride from a node) ──────────
    // Settlement v3 (2026-07-16): unified with the cash path's compute_ride_split
    // — the merchant's cut is a % of what the PLATFORM keeps, not of the gross
    // fare. Previously this path paid 5% of gross (merchant.commission_rate),
    // the cash path paid 1% of gross — two different numbers for the same rent.
    // Per-kiosk dispatch_premium_pct controls the fare uplift applied at estimate_fare.
    if (ride.vendor_node_id) {
      try {
        const { data: kiosk } = await supabaseAdmin
          .from("kiosk_nodes")
          .select("id, merchant_id, staff_member_id, dispatch_premium_pct")
          .eq("id", ride.vendor_node_id)
          .single();

        if (kiosk?.merchant_id) {
          const { data: nodeRateRow } = await supabaseAdmin
            .from("pricing_config")
            .select("value_cents")
            .eq("key", "NODE_COMMISSION_RATE_ON_PLATFORM_BPS")
            .maybeSingle()
            .then((res) => res, () => ({ data: null }));
          const nodeRate = nodeRateRow?.value_cents ? nodeRateRow.value_cents / 10000 : 0.02;

          const commissionCents = Math.round(platformFee * nodeRate);
          // Staff (if assigned to this kiosk) take a fixed slice of the
          // node's own commission — sub-commission under the merchant's
          // umbrella, not an addition on top of it.
          const staffAmountCents = kiosk.staff_member_id
            ? Math.floor(commissionCents * 0.2)
            : 0;

          if (commissionCents > 0) {
            await supabaseAdmin.from("vendor_commissions").insert({
              ride_id: ride_id,
              kiosk_node_id: kiosk.id,
              merchant_id: kiosk.merchant_id,
              staff_member_id: kiosk.staff_member_id || null,
              commission_rate: nodeRate,
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
              .then((res) => res, (err: unknown) => console.error("Merchant/staff wallet credit failed (non-fatal):", err));
          }
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
        .then((res) => res, () => ({ data: null }));

      if (merchant?.is_pinned) {
        const { data: subscription } = await supabaseAdmin
          .from("merchant_subscriptions")
          .select("pin_fee_cents")
          .eq("merchant_id", merchantId)
          .maybeSingle()
          .then((res) => res, () => ({ data: null }));

        if (subscription && (subscription.pin_fee_cents || 0) > 0) {
          await supabaseAdmin
            .from("arrival_events")
            .insert({
              ride_id: ride_id,
              merchant_id: merchantId,
              arrival_type: "dropoff",
              pin_fee_cents: subscription.pin_fee_cents,
            })
            .then((res) => res, (err: unknown) => console.error("arrival_events insert failed (non-fatal):", err));
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
        .then((res) => res, (err: unknown) => console.error("Driver referral commission failed (non-fatal):", err));
    }

    // ── DRIVER LOAN REPAYMENT ─────────────────────────────────────────────
    if (ride.driver_id) {
      await supabaseAdmin
        .rpc("deduct_loan_installment", { p_driver_id: ride.driver_id, p_ride_id: ride_id })
        .then((res) => res, (err: unknown) => console.error("Loan deduction failed (non-fatal):", err));
    }

    // ── FLEET LEASE DEDUCTION ─────────────────────────────────────────────
    let leaseDeductionCents = 0;
    let leaseDeductionStatus: "none" | "deducted" | "insufficient_balance" = "none";

    if (ride.driver_id) {
      const { data: leaseResult } = await supabaseAdmin
        .rpc("deduct_lease_installment_for_ride", { p_ride_id: ride_id })
        .then((res) => res, (err: unknown) => {
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
            .then((res) => res, (err: unknown) => console.error("Failed to update revenue log lease deduction:", err));
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
        ).then((res) => res, (err: unknown) => console.error("Rider push failed:", err));
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
              .then((res) => res, () => ({ data: null }));
            const { data: levelCfg } = await supabaseAdmin
              .from("progression_config")
              .select("push_title, push_body")
              .eq("level", result.level_after)
              .single()
              .then((res) => res, () => ({ data: null }));
            if (profile?.push_token && levelCfg) {
              sendPushNotification(
                profile.push_token,
                levelCfg.push_title,
                levelCfg.push_body,
                { type: "LEVEL_UP", level: result.level_after, unlock: result.new_unlock }
              ).then((res) => res, () => {});
            }
          }
        })
        .then((res) => res, (err: unknown) => console.error("record_rider_activity failed (non-fatal):", err));
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
        .then((res) => res, () => ({ data: null }));

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
          .then((res) => res, (err: unknown) => console.error('Band revshare insert failed (non-fatal):', err));
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
        .then((res) => res, () => ({ data: null }));

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
          .then((res) => res, (err: unknown) => console.error('Event revshare insert failed (non-fatal):', err));
      }
    }

    // ── COMMANDER REVSHARE: owned by the settlement layer, NOT here ──────────
    // compute_ride_split + record_ride_kickbacks key the 2% off the DRIVER's
    // profile and carve it from the driver pool (settlement model v2). The
    // rider-keyed block that used to live here paid commanders a SECOND time
    // from the platform's share — removed 2026-07-16.

    // ── ONBOARDING REWARDS (non-blocking) — Settlement v3, 2026-07-16 ────────
    // Both funded from capital_reserve_ledger via spend_from_reserve, never
    // from the driver/platform split. RIDER_REFERRAL_TARGET_RIDES-gated
    // (default 5); one-time wallet credit = a bps share of the referred
    // rider's LIFETIME fare paid.
    if (ride.rider_id) {
      const { data: riderRef } = await supabaseAdmin
        .from("profiles")
        .select("referral_source_driver_id, referred_by_rider_id")
        .eq("id", ride.rider_id)
        .maybeSingle()
        .then((res) => res, () => ({ data: null }));

      // Driver onboarded this rider (keychain tap / driver's own share link) → 5%.
      if (riderRef?.referral_source_driver_id) {
        await supabaseAdmin
          .rpc("increment_referral_reward_rides", {
            p_rider_id: ride.rider_id,
            p_driver_id: riderRef.referral_source_driver_id,
          })
          .then((res) => res, (err: unknown) => console.error("increment_referral_reward_rides failed (non-fatal):", err));
      }

      // Rider onboarded this rider (friends/family share link) → 3%.
      if (riderRef?.referred_by_rider_id) {
        await supabaseAdmin
          .rpc("increment_rider_referral_reward", { p_referee_rider_id: ride.rider_id })
          .then((res) => res, (err: unknown) => console.error("increment_rider_referral_reward failed (non-fatal):", err));
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
              .then((res) => res, () => ({ data: null }));
            if (driverUser?.user_id) {
              const { data: driverProfile } = await supabaseAdmin
                .from("profiles")
                .select("push_token")
                .eq("id", driverUser.user_id)
                .single()
                .then((res) => res, () => ({ data: null }));
              if (driverProfile?.push_token) {
                sendPushNotification(
                  driverProfile.push_token,
                  "BYD Lease Unlocked",
                  "You've driven 90 active days. You now qualify for a G-Taxi BYD lease. Check your app to apply.",
                  { type: "LEASE_ELIGIBLE" }
                ).then((res) => res, () => {});
              }
            }
          }
        })
        .then((res) => res, (err: unknown) => console.error("refresh_driver_lease_eligibility failed (non-fatal):", err));
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
      .then((res) => res, (err: unknown) => console.error("Failed to enqueue event:", err));

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
