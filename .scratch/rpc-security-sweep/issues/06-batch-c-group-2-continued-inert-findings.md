# Batch C, Group 2 continued: inert correctness bugs — 13 functions checked, 0 grant changes, several flagged

Status: needs-triage

## Context

Next 13 functions from the Group 2 list. All confirmed
`anon_exec=false, auth_exec=false` before this check, and confirmed via
`pg_stat_statements` (filtered to `anon`/`authenticated` roles) to have
**zero real calls ever** — fully inert today, no live exploitation, no
grant changes made. This file exists purely to record what happens the
moment any of these get a grant without this list being re-checked
first, per the standing instruction: flag inert-but-dangerous shapes
even when there's no fire today.

Ranked by how bad it would be if granted, worst first.

## Would be CRITICAL the moment they're granted

- **`credit_wallet(p_user_id, p_amount_cents, p_type, p_description,
  p_reference_id)`** — the rawest possible wallet-mutation primitive in
  the whole sweep. `p_user_id` fully caller-supplied, `p_amount_cents`
  fully caller-supplied with **no sign check** (negative = a disguised
  debit against a victim), no `auth.uid()` check anywhere, only a soft
  best-effort dedup keyed on `p_reference_id`. Same failure shape as
  `process_wallet_credit_idempotent` ([[04]]) but even less constrained
  — that one at least fixes `transaction_type` to `'topup'`; this one
  lets the caller pick the type too. **This and `process_wallet_credit_idempotent`
  are now the two functions to check first if scope ever changes on
  anything wallet-adjacent.**

- **`charge_escape_participant_wallet(p_rider_id, p_amount_cents,
  p_package_name, p_reference_id)`** — debits an arbitrary `p_rider_id`
  for an arbitrary `p_amount_cents` with **no anchor to a real
  reservation or package price** (contrast with `capture_escape_wallet_payment`,
  below, which at least requires a matching reservation row). Takes a
  cut for the platform and reserve on whatever number the caller passes.
  No `auth.uid()` check at all.

- **`admin_wallet_adjust(p_user_id, p_amount_cents, p_reason,
  p_admin_id)`** — the admin check reads `p_admin_id` (a **caller-supplied
  parameter**) against `profiles.role='admin'`, not `auth.uid()`. This
  isn't just a missing check, it's a check that trusts client input as
  if it were verified identity — anyone who knows (or guesses) a real
  admin's UUID passes the gate and can adjust any user's wallet by any
  amount. Worse than a bare missing check because it *looks* guarded.
  Compare `admin_top_up`, which does this correctly
  (`auth.uid() IS NOT NULL AND NOT EXISTS(...role='admin')` — the
  `auth.uid() IS NOT NULL` clause deliberately lets service-role calls
  through, direct authenticated calls are still gated on the real
  session identity).

- **`book_travel_atomic(p_user_id, p_package_id, ...)`** — `p_user_id`
  fully caller-supplied with no `auth.uid()` check; wallet-payment path
  debits `p_user_id`'s wallet directly. Any authenticated caller could
  book a travel package paid from an arbitrary victim's wallet balance.

## Would be MEDIUM-HIGH the moment they're granted

- **`credit_merchant_commission(p_merchant_id, p_ride_id,
  p_amount_cents)`** — arbitrary `p_merchant_id` + arbitrary
  `p_amount_cents`, no `auth.uid()` check, no idempotency guard on
  `p_ride_id` (could be called repeatedly for the same ride). Only gate
  is a feature flag (`merchant_commission_enabled`), which is an on/off
  switch, not an auth control.

- **`check_driver_referral_commission(p_driver_user_id, p_ride_id,
  p_platform_fee_cents)`** — credits `1% of p_platform_fee_cents`
  (caller-supplied) to the driver's real referrer. No idempotency check
  on `p_ride_id` — callable repeatedly for the same ride to mint
  unlimited commission, and `p_platform_fee_cents` isn't cross-checked
  against the ride's real fee.

- **`capture_escape_wallet_payment(p_reservation_id, p_rider_id)`** —
  better than `charge_escape_participant_wallet` in that it requires a
  real `package_reservations` row matching BOTH ids (`WHERE id =
  p_reservation_id AND rider_id = p_rider_id`), so the amount charged is
  anchored to something real. But there's no check that the *caller* is
  `p_rider_id` — anyone who knows a victim's `(reservation_id, rider_id)`
  pair could force-capture the payment early.

- **`admin_process_kickback_payout(p_recipient_type, p_recipient_id,
  p_admin_id)`** and **`admin_process_revshare_payout(p_ledger_type,
  p_organizer_id, p_admin_id)`** — same shape as each other. Neither
  verifies `p_admin_id` against anything (it's just stored as
  `processed_by` in the audit row, never checked). Both only flip
  ledger rows to `'paid'` — no `wallet_transactions` write, so this
  isn't direct fund theft, but it's a real ledger-integrity risk: an
  unauthenticated-in-practice caller could mark real pending payout
  obligations as already settled, hiding money still owed to a
  commander/vendor/band/organizer.

## Low priority — target isn't spoofable, or read-only

- **`deduct_daily_lease_fee(p_lease_id, p_date)`** — target driver is
  derived from `p_lease_id → fleet_leases → drivers`, not
  caller-supplied, and the deduction is idempotent per billing period
  (`NOT EXISTS` guard). No `auth.uid()` check on who can trigger it, but
  the blast radius if triggered is "today's real lease fee, once." Low
  urgency.
- **`apply_lease_daily_fees()`** and **`apply_lease_daily_fees(p_date)`**
  — cron sweep functions, process every active lease uniformly, no
  caller-supplied target. Correct shape for a scheduled job.
- **`check_driver_debt_limit(p_driver_id)`** — read-only, returns a
  boolean, no writes.

## Fix, when picked up (not now — all inert, no urgency)

Standard pattern for each caller-supplied-target function: add
`IF p_user_id/p_rider_id/p_admin_id IS DISTINCT FROM auth.uid() THEN
RETURN ...unauthorized...` if meant to be user-scoped, or move the
admin/service check to `auth.uid()` against `profiles.role='admin'` (not
a parameter) if meant to be admin-only. Add idempotency guards where
missing (`check_driver_referral_commission`, `credit_merchant_commission`).
Add a sign check to `credit_wallet` (`p_amount_cents` should not be
allowed to silently masquerade as a debit under a credit-sounding
`p_type`, or should require an explicit debit RPC instead).
