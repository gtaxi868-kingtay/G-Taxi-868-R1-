# `credit_merchant_commission` signature mismatch — kiosk merchant/staff wallet credits have never fired

Status: ready-for-human (live production bug, not a hardening item)

## What

Real caller (`supabase/functions/complete_ride/index.ts:698-704`, fresh-read
2026-08-13):

```ts
await supabaseAdmin.rpc("credit_merchant_commission", {
  p_merchant_id: kiosk.merchant_id,
  p_ride_id: ride_id,
  p_amount_cents: commissionCents,
  p_staff_member_id: kiosk.staff_member_id || null,
  p_staff_amount_cents: staffAmountCents,
})
.then((res) => res, (err) => console.error("Merchant/staff wallet credit failed (non-fatal):", err));
```

Deployed function:

```sql
CREATE OR REPLACE FUNCTION public.credit_merchant_commission(
  p_merchant_id uuid, p_ride_id uuid, p_amount_cents integer
) RETURNS void ...
```

Only 3 parameters, no `p_staff_member_id` / `p_staff_amount_cents`, no
defaults. The RPC call passes 5 named parameters — PostgREST can't
resolve this to any function overload, so **every call fails**. It's
wired non-fatal (`.then(_, err => console.error(...))`), so it fails
silently — no error surfaces to the rider, driver, or admin, ride
completion proceeds normally.

## Real-world impact

Found: 0 rows in `wallet_transactions` with `transaction_type =
'merchant_commission'` ever, and 0 `brokerage_commission` rows (separate
issue, [[10]]) — confirms this RPC has never once succeeded.

**Every kiosk-node ride's merchant commission credit and staff-member
split has silently failed.** The `vendor_commissions` ledger row
(inserted separately, immediately before this call, and NOT part of
this bug) does get written with `status = 'pending'` — so the platform
has an accurate record of commission owed, but the "credit merchant +
staff wallets immediately" step the comment describes has never
actually happened. Currently 0 pending `vendor_commissions` rows exist,
consistent with the "1 active commander, kiosk hardware not yet
provisioned" state noted in CLAUDE.md — so this is a real bug with (so
far) no real financial impact, but it's guaranteed to hit the day a
physical kiosk node is provisioned and starts producing rides.

## The staff-split feature doesn't exist in the function at all

This isn't just a parameter-count mismatch — `credit_merchant_commission`
has no concept of `p_staff_member_id`/`p_staff_amount_cents` anywhere in
its body. The 20%-to-staff split (`staffAmountCents =
Math.floor(commissionCents * 0.2)` when `kiosk.staff_member_id` is set,
computed in `complete_ride/index.ts:681-683`) was written into the
caller but never implemented in the RPC. This is a half-shipped feature,
not a drifted signature.

## Fix, when picked up

`credit_merchant_commission` needs to be rewritten to:
1. Accept `p_staff_member_id uuid DEFAULT NULL` and `p_staff_amount_cents
   integer DEFAULT 0`.
2. Credit the merchant's `created_by` user with `p_amount_cents -
   p_staff_amount_cents` (or however the split is meant to divide —
   confirm against `merchant_staff.commission_rate` if that column is
   meant to be the source of truth instead of the caller's hardcoded
   20%).
3. Credit the staff member (resolve via `merchant_staff` →
   `merchant_staff.user_id`) with `p_staff_amount_cents` when
   `p_staff_member_id` is provided.
4. Still respects the existing `feature_enabled('merchant_commission_enabled')`
   gate and the `merchants.created_by IS NULL` no-op (CLAUDE.md notes no
   live merchant has an owner account linked today, so even a correct
   fix will no-op until that's addressed too — separate gap).

Dry-run in a rolled-back transaction against a synthetic merchant +
merchant_staff row before applying; live-verify by simulating the real
`complete_ride` call shape (5 named params), not the old 3-param
signature.
