# `check_driver_referral_commission` filters on a status value that can never exist

Status: ready-for-human (live-broken feature, found while adding an unrelated idempotency guard)

## What

```sql
SELECT referrer_id INTO v_referrer_id
FROM referral_earnings
WHERE referee_id = p_driver_user_id
  AND type = 'driver'
  AND status = 'active'
  AND (expires_at IS NULL OR expires_at > now())
LIMIT 1;
```

`referral_earnings_status_check` only permits `'pending' | 'paid' |
'expired'` — `'active'` is not a legal value and can never be inserted.
The only real inserter, `apply_referral_code` (both copies — baseline
migration and the settlement-v3 migration — read fresh, identical),
always writes `status = 'paid'`. So this `SELECT` can never match a row,
for any driver, ever — the 1%-of-platform-fee driver referral
commission has never fired, for a reason completely unrelated to the
idempotency gap this function also had ([[check_driver_referral_commission
idempotency guard added 2026-08-13]]).

## Real-world impact

Confirmed no way to construct a test row with `status='active'` even in
a rolled-back transaction — the CHECK constraint blocks it outright, so
this isn't a "rare edge case," it's structurally impossible for the
lookup to ever succeed as written.

## Fix, when picked up

Change the filter to `status = 'paid'` to match what `apply_referral_code`
actually writes. Confirm that's the intended semantic (a "paid" referral
earning record representing an active, usable referral relationship —
distinct from `wallet_transactions.status`, which uses `'completed'` for
the same concept) before changing it; this file exists to flag the bug,
not prescribe the exact replacement value without that confirmation.
