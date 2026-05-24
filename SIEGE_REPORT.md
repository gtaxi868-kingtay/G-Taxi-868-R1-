# SIEGE REPORT: G-TAXI FINANCIAL ARCHITECTURE
## Risk Management Audit — Catastrophic Failure Points

**Classification:** CONFIDENTIAL — SYSTEMS ARCHITECTURE INTERNAL
**Date:** 2026-05-22
**Scope:** 4 settlement paths (wallet, cash, card, admin force-complete) + fleet/asset ledger

---

## EXECUTIVE SUMMARY

This system has **5 catastrophic failure points** that would cause financial loss, legal liability consolidation, or revenue leakage. Three are actively crashing right now. Two are architectural decisions that will compound over time.

The most urgent: **`driverPayoutCents` is always `undefined`** on every ride completion through the primary `complete_ride` endpoint. Drivers are not being credited correctly, and the platform revenue logs are being written with NULL payouts.

---

## CATASTROPHIC FAILURE #1 (CRITICAL — CRASHING TODAY)
## `driverPayoutCents` Is Always `undefined`

**File:** `supabase/functions/complete_ride/index.ts`, line 220

**The Bug:**
```typescript
// Line 78 — the function returns this:
return { reserveCents, netFare, platformFee, driverPayout }
                                         // ^^^^ note: "driverPayout"

// Line 220 — but we destructure this:
const { reserveCents, platformFee, driverPayoutCents } = computeSettlement(effectiveFare);
                                         // ^^^^^^^^^^^^^^^^ note: "driverPayoutCents"
```

The object has property `driverPayout`. The destructuring asks for `driverPayoutCents`. JavaScript returns `undefined` for missing properties. No TypeScript error because both are valid identifiers.

**This `undefined` contaminates 3 downstream writes:**

| Line | Column | What Gets Written | Impact |
|------|--------|-------------------|--------|
| 313 | `driver_payout_cents` | `undefined` | Ride record has NULL driver payout |
| 339 | `p_payout_cents` | `undefined` | Revenue log has NULL payout |
| 272 | `driver_payout: driverPayoutCents` | `undefined` | Console log shows undefined |

**Wallet path is protected** because `process_wallet_payment_hardened` internally recalculates via the SQL RPC and ignores the JS value. But **cash path** and **card path** through `complete_ride` compute the payout from the `undefined` value.

**Fix:** Change line 220 to:
```typescript
const { reserveCents, platformFee, driverPayout: driverPayoutCents } = computeSettlement(effectiveFare);
```

Or rename the return property in `computeSettlement` to `driverPayoutCents`.

---

## CATASTROPHIC FAILURE #2 (CRITICAL — CRASHING TODAY)
## Stripe Webhook Always Returns HTTP 200

**File:** `supabase/functions/stripe_webhook/index.ts`

Five sequential writes happen after Stripe confirms a successful charge:

| Step | What | Error Handling | Consequence If It Fails |
|------|------|---------------|------------------------|
| B | Credit driver wallet | `.catch()` logs, continues | Driver never paid |
| C | Credit platform fee | `.catch()` logs, continues | Platform revenue lost |
| D | Credit capital reserve | `.catch()` logs, continues | War Chest misses allocation |
| E | Insert capital_reserve_ledger | `.catch()` logs, continues | No immutable record |
| F | Update ride payment_status | `.catch()` logs, continues | UI shows unpaid ride |

**Every single step can fail independently, and the function ALWAYS returns 200 to Stripe.** Stripe interprets 200 as "processed successfully" and **never retries this webhook event**. Money was collected from the rider's card, but:
- The driver never gets paid
- The platform never records its revenue
- The War Chest never receives its allocation
- Nobody gets notified

**Fix:** Return 500 if any step fails, so Stripe retries. Add an idempotency check for the recovery path.

---

## CATASTROPHIC FAILURE #3 (ARCHITECTURAL — BUILDING TODAY)
## No Legal Entity Isolation — Single Wallet for Everything

**File:** ALL financial functions reference `PLATFORM_ACCOUNT = "00000000-0000-0000-0000-000000000000"`

Every revenue type flows into this single UUID:

```
Ride platform fee        → wallet_transactions(user_id='000...', amount=+$18.22)
Capital reserve 1.5%     → wallet_transactions(user_id='000...', amount=+$1.50)
Fleet lease daily fee    → wallet_transactions(user_id='000...', amount=+$45.00)
Fleet lease mileage      → wallet_transactions(user_id='000...', amount=+$10.00)
```

**This is the one line of code that exposes your asset-holding companies to ride-share liability.**

If someone sues the ride-hailing operating company, a plaintiff's attorney subpoenas the `wallet_transactions` table. The balance for `00000000-...` shows commingled funds from ride operations AND fleet leasing AND the capital reserve. A court order freezing that wallet simultaneously freezes:
- The fleet leasing company's daily fee revenue
- The capital reserve (emergency fund)
- The platform's operating income

**There is no `legal_entity_id` column, no `metadata` column, no sub-account, no tag.** The `transaction_type` differentiates the *kind* of transaction but not the *entity* to which it belongs.

**Fix:** 
- Create separate wallet accounts per legal entity: `0000...-ride-ops`, `0000...-fleet-ltd`, `0000...-capital-reserve`
- Add `legal_entity_id` column to `wallet_transactions` with a FK to a `legal_entities` table
- Tag every financial transaction with its source entity at insert time

---

## CATASTROPHIC FAILURE #4 (COMPOUNDING — BUILDING TODAY)
## No Collusion Detection — 19% Fee Leakage Is Invisible

**The app has a `platform_leakage_detected` column on the `rides` table. It is never set to `true` by any code, anywhere.** It is a dead column — schema only, zero logic.

No code exists for:
- Driver/rider pair frequency analysis
- "App abandonment" detection (stop using app after 3 matches → go cash)
- GPS spoofing correlation
- Duplicate device matching
- Payment method switching patterns

A driver and rider can:
1. Accept 3 rides through the app (paying 19% fee)
2. Exchange phone numbers
3. Complete all future rides off-app (zero fee)

**The system has zero visibility into this.** No alerts, no reports, no automated investigation queue.

**Fix:**
- Implement a daily batch that queries `rides` for driver/rider pair counts: `SELECT driver_id, rider_id, COUNT(*) FROM rides GROUP BY driver_id, rider_id HAVING COUNT(*) BETWEEN 2 AND 5`
- Flag pairs where `payment_method` switches from `wallet` to `cash` after the initial rides
- Cross-reference `driver_locations` with `rides` — if the GPS path shows the vehicle moving from pickup to dropoff for a "cash" ride that was never created in the system, something is wrong

---

## CATASTROPHIC FAILURE #5 (COMPOUNDING — BUILDING TODAY)
## Zero Driver Retention — They Leave for 1% More

The only mechanism that creates switching costs for drivers is **fleet leasing debt**. A driver who owes daily lease arrears has a financial reason to stay. Everyone else can leave for a competitor offering a 1% higher payout with zero friction.

The `bonus` transaction type exists in the schema as a placeholder. Zero code ever inserts a `bonus` transaction. Zero loyalty tiers. Zero escored rewards. Zero vesting.

**The platform currently extracts $19.72 per $100 ride but invests $0.00 of that into driver retention.**

**Fix:** Implement a "Stickiness Pool":
- Hold back 0.5% of each driver payout (i.e., payout becomes 79.777% instead of 80.277%)
- Credit this to a `vested_bonus` ledger entry per driver
- Release the escrowed bonus after:
  - 100 completed rides within a rolling 30-day window
  - OR zero cancels in 7 days
  - OR refer a new driver who completes 50 rides
- If driver deactivates, the escrowed bonus is **forfeited** — creates real switching cost

This is independent of the current payout logic. The base payout math stays unchanged; the bonus is computed as a separate credit line after settlement.

---

## THE FIVE SPOFS RANKED

| Rank | Failure | Severity | Detection Time | Resolution Time |
|------|---------|----------|---------------|----------------|
| 1 | `driverPayoutCents` undefined | **CRITICAL** | Immediate (divide-by-zero-like behavior) | 1 line fix |
| 2 | Stripe webhook returns 200 on failure | **CRITICAL** | On first failed webhook (Stripe logs it) | 15-line fix |
| 3 | No legal entity isolation | **HIGH** | On first lawsuit or audit | Schema migration + 5 edge function changes |
| 4 | No collusion detection | **HIGH** | Never (you won't know what you don't know) | New batch job |
| 5 | No driver retention | **MEDIUM** | When churn rate exceeds acquisition rate | New function + escrow table |

---

## RECOMMENDED INVESTMENT ORDER

| Priority | Action | Cost | Protection |
|----------|--------|------|-----------|
| P0 | Fix `driverPayoutCents` naming bug | 1 line | Stops NULL payout writes immediately |
| P0 | Make stripe_webhook return 500 on partial failure | 15 lines | Ensures Stripe retries failed disbursements |
| P1 | Split `PLATFORM_ACCOUNT` into separate legal entity wallets | 2-3 days | Prevents lawsuit contagion across entities |
| P1 | Add UNIQUE constraint on `capital_reserve_ledger(ride_id)` | 1 line | Prevents duplicate War Chest credits |
| P2 | Implement daily collusion detection batch | 1 day | Stops 19% fee leakage |
| P2 | Implement stickiness pool (0.5% escrow) | 2 days | Creates driver switching cost |
| P3 | Add `legal_entity_id` to `wallet_transactions` | 1 day | Clean entity-isolated audit trail |
| P3 | Wire rate limiting to remaining 9 edge functions | 4 hours | Prevents API abuse |

---

## THE LINES OF CODE THAT KEEP ME UP AT NIGHT

```typescript
// File: supabase/functions/complete_ride/index.ts, line 220
const { reserveCents, platformFee, driverPayoutCents } = computeSettlement(effectiveFare);
// driverPayoutCents is undefined. This line costs drivers money on EVERY ride.
```

```typescript
// File: supabase/functions/stripe_webhook/index.ts, lines 183-261
// Five .catch() handlers that swallow errors and return HTTP 200.
// If any fails, the money is gone with no automated recovery.
```

```typescript
// File: ALL financial functions
const PLATFORM_ACCOUNT = "00000000-0000-0000-0000-000000000000";
// A single UUID that commingles ride ops, fleet leasing, and capital reserve.
// One lawsuit freezes everything.
```

```sql
-- Migration: 20260223000000_phase8_failsafes.sql
ALTER TABLE rides ADD COLUMN platform_leakage_detected BOOLEAN DEFAULT false;
-- This column exists. No code ever sets it to true. It is a lie.
```

---

*"It survives a siege" means the system keeps paying drivers, keeps collecting revenue, and keeps the War Chest growing — even when someone is actively trying to break it. Right now, it survives nothing. Three of the five catastrophic failures are tripping on every single ride."*
