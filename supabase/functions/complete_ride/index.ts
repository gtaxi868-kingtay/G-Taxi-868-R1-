// Supabase Edge Function: complete_ride
// ============================================================
// CAPITAL RESERVE LOCK — Settlement Engine (2026-05-22)
// ============================================================
// Settlement math (server-side only — app is purely display):
//   reserve      = round(gross * 0.015)     → capital_reserve_ledger
//   net          = gross - reserve
//   platform_fee = round(net * 0.185)       → platform_revenue_logs
//   driver_payout = net - platform_fee       → wallet / cash
//   Invariant: reserve + platform_fee + driver_payout = gross
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
 * Must match the calculate_settlement() RPC exactly (p_gross_cents * 0.015).
 */
function computeSettlement(grossCents: number): {
  reserveCents: number;
  netFare: number;
  platformFee: number;
  driverPayoutCents: number;
} {
  const reserveCents = Math.round(grossCents * 0.015);
  const netFare = grossCents - reserveCents;
  const platformFee = Math.round(netFare * 0.185);
  const driverPayoutCents = netFare - platformFee;
  return { reserveCents, netFare, platformFee, driverPayoutCents };
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

    // ── GROSS FARE CALCULATION (server-side, fully) ─────────────────────────
    const pickupWaitSec = ride.pickup_wait_seconds || 0;
    const billablePickupSec = Math.max(0, pickupWaitSec - 180);
    const billablePickupFareCents = Math.floor((billablePickupSec / 60) * 90);

    const stopWaitSec = ride.stop_wait_seconds || 0;
    const billableStopFareCents = Math.floor((stopWaitSec / 60) * 90);

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

    // ── SETTLEMENT MATH (single source of truth — server only) ──────────────
    const { reserveCents, platformFee, driverPayoutCents } = computeSettlement(effectiveFare);

    // ── PAYMENT PROCESSING ──────────────────────────────────────────────────
    if (ride.payment_method === "wallet" && ride.payment_status !== "captured") {
      // Wallet path: RPC handles the new math internally + reserve insert
      const { data: walletSuccess, error: payError } = await supabaseAdmin.rpc(
        "process_wallet_payment",
        { p_ride_id: ride_id, p_amount: effectiveFare }
      );

      if (payError || !walletSuccess) {
        console.error("Wallet payment failed:", payError);
        return new Response(
          JSON.stringify({ success: false, error: "Payment failed: Insufficient wallet funds", data: { required: effectiveFare } }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else if (ride.payment_method === "cash") {
      // ── CASH PATH: Shadow ledger with new settlement math ──────────────────
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

      const driverUserId = await resolveDriverAuthUserId(supabaseAdmin, driverRecord, ride.driver_id);

      if (!driverUserId) {
        console.error("Cash settlement: could not resolve driver auth user_id", { ride_id, driver_id: ride.driver_id });
        return new Response(
          JSON.stringify({ success: false, error: "Driver account not found for settlement", data: null }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Cash driver owes platform: platformFee + reserve (they collected the full fare)
      // reserve and platform_fee are deducted as a single commission entry
      const totalPlatformCents = platformFee + reserveCents;

      console.log("[SHADOW_LEDGER][completeRide]", {
        ride_id,
        gross_cents: effectiveFare,
        reserve_cents: reserveCents,
        platform_fee: platformFee,
        driver_payout: driverPayoutCents,
        payment_method: "cash",
        driver_user_id: driverUserId,
      });

      await supabaseAdmin.from("wallet_transactions").insert({
        user_id: driverUserId,
        ride_id: ride_id,
        amount: -totalPlatformCents,
        transaction_type: "commission_fee",
        description: `Platform (${((platformFee / effectiveFare) * 100).toFixed(1)}%) + War Chest (1.5%) on cash ride`,
        status: "completed",
      });

      // Write the capital reserve directly
      await supabaseAdmin.from("capital_reserve_ledger").insert({
        ride_id: ride_id,
        amount_cents: reserveCents,
        status: "locked",
        notes: "Cash ride — reserve locked via shadow ledger",
      });

      // Write payment_ledger entry for cash ride
      await supabaseAdmin.from("payment_ledger").insert({
        ride_id: ride_id,
        user_id: ride.rider_id,
        amount: effectiveFare / 100,
        currency: "TTD",
        status: "captured",
        provider: "cash",
      }).catch((err) => console.error("Cash payment_ledger insert failed:", err));

    } else if (ride.payment_method === "card") {
      if (ride.payment_status !== "captured") {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Card payment has not been captured yet.",
            data: { payment_status: ride.payment_status },
          }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ── UPDATE RIDE RECORD ─────────────────────────────────────────────────
    const { error: updateError, count } = await supabaseAdmin
      .from("rides")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        driver_payout_cents: driverPayoutCents,
        reserve_cents: reserveCents,
        platform_fee_cents: platformFee,
      }, { count: "exact" })
      .eq("id", ride_id)
      .in("status", ["in_progress"]);

    if (updateError || count === 0) {
      console.error("Ride status update failed:", updateError);
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

    // ── FLEET LEASE DEDUCTION ─────────────────────────────────────────────
    let leaseDeductionCents = 0;
    let leaseDeductionStatus: "none" | "deducted" | "insufficient_balance" = "none";

    if (ride.driver_id) {
      const { data: leaseResult } = await supabaseAdmin
        .rpc("deduct_lease_for_ride", { p_ride_id: ride_id })
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
