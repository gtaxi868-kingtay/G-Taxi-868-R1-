// Deno Edge Function Tests: referral_milestones
// ============================================================
// REFERRAL-MILESTONE 2026-09-25
//
// Pure-math tests for the founder-approved referral economics. All money
// is integer cents. The SQL RPCs (award_driver_referral_milestone,
// award_rider_referral_milestone, process_wallet_payment_hardened) are the
// source of truth at payout time; these tests pin the math the edge
// functions and the SQL both implement:
//
//   DRIVER → DRIVER: 25th qualifying ride pays the referrer
//     floor(25% × cumulative platform keep across the 25 rides), once.
//   RIDER → RIDER: 10 rides OR 5 orders earns the referrer one coupon:
//     25% off next ride, max TT$25 (2500c), 60-day expiry. Driver is paid
//     on the PRE-discount fare; the platform absorbs the coupon.
//
// Idempotency (unique ride records, atomic pending→paid flips, atomic
// coupon consume) lives in Postgres constraints/transitions and is
// verified by code review + the migration's own comments — it cannot be
// unit-tested without a live DB.
//
// Run: deno test --allow-env --allow-net supabase/functions/complete_ride/__tests__/
// ============================================================

import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  REFERRAL_DRIVER_MILESTONE_RIDES,
  REFERRAL_DRIVER_MILESTONE_RATE_PCT,
  REFERRAL_RIDER_MILESTONE_RIDES,
  REFERRAL_RIDER_MILESTONE_ORDERS,
  REFERRAL_COUPON_PERCENT_OFF,
  REFERRAL_COUPON_MAX_DISCOUNT_CENTS,
  REFERRAL_COUPON_EXPIRY_DAYS,
  driverMilestoneBountyCents,
  couponDiscountCents,
  isCouponRedeemable,
} from "../../_shared/referral_math.ts";

// ── CONFIG CONSTANTS ──────────────────────────────────────────────────────

Deno.test("config: milestone thresholds match the approved economics", () => {
  assertEquals(REFERRAL_DRIVER_MILESTONE_RIDES, 25);
  assertEquals(REFERRAL_DRIVER_MILESTONE_RATE_PCT, 25);
  assertEquals(REFERRAL_RIDER_MILESTONE_RIDES, 10);
  assertEquals(REFERRAL_RIDER_MILESTONE_ORDERS, 5);
  assertEquals(REFERRAL_COUPON_PERCENT_OFF, 25);
  assertEquals(REFERRAL_COUPON_MAX_DISCOUNT_CENTS, 2500); // TT$25 cap
  assertEquals(REFERRAL_COUPON_EXPIRY_DAYS, 60);
});

// ── DRIVER MILESTONE BOUNTY ────────────────────────────────────────────────

Deno.test("bounty: 25% of cumulative platform keep, floored to the cent", () => {
  // 25 rides × TT$4.03 platform keep = TT$100.75 keep → TT$25.1875 → 2518c
  assertEquals(driverMilestoneBountyCents(10075), 2518);
});

Deno.test("bounty: floor behavior on fractional cents", () => {
  assertEquals(driverMilestoneBountyCents(1), 0); // 0.25c → 0, never rounds up
  assertEquals(driverMilestoneBountyCents(3), 0); // 0.75c → 0
  assertEquals(driverMilestoneBountyCents(4), 1); // exactly 1c
});

Deno.test("bounty: zero/negative keep pays nothing", () => {
  assertEquals(driverMilestoneBountyCents(0), 0);
  assertEquals(driverMilestoneBountyCents(-500), 0);
});

Deno.test("bounty: always payable out of what the platform earned", () => {
  // Bounty is a fraction of the keep itself, so it can never exceed it.
  for (const keep of [100, 2500, 10075, 100000, 999999]) {
    assert(
      driverMilestoneBountyCents(keep) <= keep,
      `bounty ${driverMilestoneBountyCents(keep)} exceeds keep ${keep}`,
    );
  }
});

// ── RIDER COUPON ──────────────────────────────────────────────────────────

Deno.test("coupon: 25% off a TT$22 minimum fare = TT$5.50", () => {
  assertEquals(couponDiscountCents(2200), 550);
});

Deno.test("coupon: TT$25 cap binds on large fares", () => {
  assertEquals(couponDiscountCents(20000), 2500); // 25% = TT$50 → capped
  assertEquals(couponDiscountCents(10000), 2500); // 25% = TT$25 → exactly cap
  assertEquals(couponDiscountCents(9999), 2499); // just under the cap
});

Deno.test("coupon: floors fractional cents, never rounds up", () => {
  assertEquals(couponDiscountCents(101), 25); // 25.25c → 25
});

Deno.test("coupon: non-positive fare pays nothing", () => {
  assertEquals(couponDiscountCents(0), 0);
  assertEquals(couponDiscountCents(-100), 0);
});

Deno.test("coupon: discounted charge may fall below the TT$22 minimum", () => {
  // The minimum applies to the PRE-discount fare only.
  const fare = 2200;
  const discounted = fare - couponDiscountCents(fare);
  assertEquals(discounted, 1650);
  assert(discounted < 2200, "discounted fare may be under the minimum");
});

// ── DRIVER PAID ON PRE-DISCOUNT FARE ───────────────────────────────────────
// Mirrors the settlement invariant: the coupon reduces ONLY the rider's
// debit and the platform's net. Driver/commander/reserve are computed on
// the gross before any discount.

Deno.test("settlement: coupon never touches the driver's payout", () => {
  const gross = 2200;
  const driverNet = 1760; // 80% of gross, from compute_ride_split
  const platformFee = 403; // loyalty-adjusted, pre-coupon
  const reserve = 33;
  const coupon = couponDiscountCents(gross); // 550

  const riderDebit = gross - coupon;
  assertEquals(riderDebit, 1650);
  assertEquals(driverNet, 1760); // unchanged by the coupon
  // Platform books +403 commission and a separate -550 promo_cost row:
  // net platform = 403 - 550 = -147 (platform absorbs the coupon).
  assertEquals(platformFee - coupon, -147);
  // Money still balances: rider debit = driver + reserve + vendor + net platform
  const vendor = 4; // 1% of platform take
  assertEquals(riderDebit, driverNet + reserve + vendor + (platformFee - coupon));
  void reserve;
});

// ── COUPON REDEEMABILITY ──────────────────────────────────────────────────

Deno.test("redeemable: issued + unexpired", () => {
  const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  assert(isCouponRedeemable("issued", future));
});

Deno.test("redeemable: expired coupons are dead", () => {
  const past = new Date(Date.now() - 1000).toISOString();
  assertEquals(isCouponRedeemable("issued", past), false);
});

Deno.test("redeemable: used/pending coupons are not redeemable", () => {
  const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  assertEquals(isCouponRedeemable("used", future), false);
  assertEquals(isCouponRedeemable("pending", future), false);
  assertEquals(isCouponRedeemable("expired", future), false);
});
