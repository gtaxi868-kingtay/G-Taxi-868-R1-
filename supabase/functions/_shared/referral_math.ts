// REFERRAL-MILESTONE 2026-09-25
// Pure referral-economics helpers shared by the edge functions and the Deno
// unit tests. All money is integer cents. The SQL RPCs
// (award_driver_referral_milestone / process_wallet_payment_hardened) are the
// source of truth at payout time; these helpers mirror their math so the
// edge functions can quote/estimate without touching the database twice.

/** Referred driver must complete this many qualifying rides. */
export const REFERRAL_DRIVER_MILESTONE_RIDES = 25;
/** Referrer's one-time bounty = this % of cumulative platform keep. */
export const REFERRAL_DRIVER_MILESTONE_RATE_PCT = 25;

/** Referred rider milestone: this many qualifying rides... */
export const REFERRAL_RIDER_MILESTONE_RIDES = 10;
/** ...OR this many qualifying orders earns the referrer one coupon. */
export const REFERRAL_RIDER_MILESTONE_ORDERS = 5;

/** Coupon: percent off the next ride. */
export const REFERRAL_COUPON_PERCENT_OFF = 25;
/** Coupon: maximum discount, TT$25 = 2500 cents. */
export const REFERRAL_COUPON_MAX_DISCOUNT_CENTS = 2500;
/** Coupon: expires this many days after issue. */
export const REFERRAL_COUPON_EXPIRY_DAYS = 60;

/**
 * Driver→driver milestone bounty: 25% of the platform's keep summed across
 * the 25 rides, floored to the cent. Mirrors the SQL:
 *   FLOOR(platform_keep_cents * 0.25)
 */
export function driverMilestoneBountyCents(platformKeepCentsTotal: number): number {
  if (platformKeepCentsTotal <= 0) return 0;
  return Math.floor((platformKeepCentsTotal * REFERRAL_DRIVER_MILESTONE_RATE_PCT) / 100);
}

/**
 * Referral coupon discount: 25% of the fare, capped at TT$25 (2500 cents).
 * The DISCOUNTED charge may fall below the TT$22 ride minimum — the minimum
 * applies to the pre-discount fare only.
 */
export function couponDiscountCents(
  fareCents: number,
  percentOff: number = REFERRAL_COUPON_PERCENT_OFF,
  maxDiscountCents: number = REFERRAL_COUPON_MAX_DISCOUNT_CENTS,
): number {
  if (fareCents <= 0 || percentOff <= 0) return 0;
  return Math.min(Math.floor((fareCents * percentOff) / 100), maxDiscountCents);
}

/**
 * Redeemability check mirroring the SQL consume guard in
 * process_wallet_payment_hardened (status='issued' AND unexpired).
 */
export function isCouponRedeemable(
  status: string,
  expiresAt: string | Date,
  now: Date = new Date(),
): boolean {
  return status === "issued" && new Date(expiresAt).getTime() > now.getTime();
}
