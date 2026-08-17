# Batch C, Group 2: 4 real findings, all fixed 2026-08-12

Status: wontfix (resolved, keeping as record)

## What was found

Swept the ~40-function group. Grant check first flagged 10 functions with
`auth_exec=true`; six were correctly self-scoped or role-gated
(`get_wallet_balance`, `get_my_deletion_status`, `request_account_deletion`,
`rider_join_g_spot_venue`, `admin_get_tax_position`,
`check_global_debt_blocking` — the last is a trigger function, unreachable
via RPC regardless of grant). Four were not:

- **`spend_from_reserve`** (CRITICAL) — `p_recipient_user_id` fully
  caller-supplied, no ownership/role check, `auth_exec=true`. Any signed-in
  user could call it directly and drain `capital_reserve_ledger` into an
  arbitrary wallet as a `'bonus'` transaction, gated only by
  `p_amount_cents > 0` and current `reserve_health.locked_cents`. Real
  callers (`increment_referral_reward_rides`,
  `increment_rider_referral_reward`) only ever reach it as a nested
  `SECURITY DEFINER` call from a service-role-invoked wrapper — the direct
  `authenticated` grant wasn't load-bearing for any legitimate path.
  Fixed: `REVOKE ... FROM anon, authenticated, PUBLIC`.

- **`merchant_wallet_charge`** (CRITICAL) — `p_merchant_id` caller-supplied
  as the credit target, `auth_exec=true` (inherited default-privilege grant
  — never explicitly granted to `authenticated`, only `service_role` was).
  Any signed-in user (rider, driver, anyone) could charge up to TT$2,000
  off any rider's wallet by NFC `tag_uid` and route the proceeds to any
  merchant. Real caller (`merchant_nfc_charge` edge function) uses
  service_role, and does its own ownership check (merchant owns or staffs
  `merchant_id`, plus a mismatch check) before calling — grant wasn't
  load-bearing. Fixed: `REVOKE ... FROM anon, authenticated, PUBLIC`.

- **`resolve_identity_tag`** (MEDIUM — PII/balance disclosure) —
  `auth_exec=true`, deliberately granted (comment: "merchant-facing... 
  merchant uses this before charging"). No check that the caller is
  actually a merchant. Any signed-in user could resolve a `tag_uid` to a
  rider's name + wallet balance. Real caller
  (`apps/merchant-mobile/.../NfcAcceptPaymentScreen.tsx`) calls this
  **client-side with the merchant's own JWT** — grant IS load-bearing, a
  bare `REVOKE` would have broken the legitimate merchant flow. Fixed
  with an internal check instead: caller must own or staff an active row
  in `merchants`/`merchant_staff`.

- **`apply_referral_code`** (HIGH) — `p_referee_id` fully caller-supplied,
  no ownership check, `auth_exec=true` (inherited default grant). Any
  signed-in user could credit TT$15 to themselves as referrer plus TT$15
  to an arbitrary third party's `p_referee_id`, repeatable per distinct
  referee, farming the referral bonus budget. Real legitimate caller
  (`apps/rider/src/screens/SignupScreen.tsx`) always passes
  `p_referee_id: authData.user.id` — client-side, user-scoped, grant IS
  load-bearing. Fixed with an internal check instead:
  `IF p_referee_id IS DISTINCT FROM auth.uid() THEN return unauthorized`.

All four: dry-run in a rolled-back transaction, applied via
`apply_migration` (`group2_lock_referral_tag_merchant_charge_reserve`),
then live-verified — `merchant_wallet_charge` and `spend_from_reserve`
via real anon-key REST probes (both now `401 permission denied`);
`apply_referral_code` and `resolve_identity_tag` via a rolled-back
transaction simulating an authenticated-but-unauthorized caller
(`SET LOCAL role authenticated` + a spoofed `request.jwt.claims.sub`),
confirming both new internal checks reject impersonation while the real
grant (still present for the legitimate JWT-based caller) is untouched.

## The lesson this reinforces

Two of four looked identical at the grant level (`auth_exec=true`, no
internal check) but needed opposite fixes. The only way to tell them
apart was tracing the real caller: `merchant_wallet_charge` and
`spend_from_reserve`'s legitimate callers were service-role edge
functions/nested `SECURITY DEFINER` wrappers (revoke is safe);
`resolve_identity_tag` and `apply_referral_code`'s legitimate callers
were mobile screens calling `supabase.rpc()` directly with the user's own
JWT (revoke would have broken production; needed an internal ownership
check instead). Grepping `apps/` for the RPC name, not just
`supabase/functions/`, was what surfaced the difference.

## Remaining Group 2 functions

Grant-checked and confirmed `anon_exec=false, auth_exec=false` (not
independently reachable today, standard three-check + nested-call trace
still owed before this group can be marked fully closed):
`admin_process_kickback_payout, admin_process_revshare_payout, admin_top_up,
admin_wallet_adjust, apply_lease_daily_fees (both overloads),
book_travel_atomic, capture_escape_wallet_payment,
charge_escape_participant_wallet, check_driver_debt_limit,
check_driver_referral_commission, credit_merchant_commission, credit_wallet,
deduct_daily_lease_fee, deduct_wallet_balance, driver_qualifies_loyalty_rate,
expire_stale_withdrawal_codes, fn_auto_reactivate_driver,
generate_cash_withdrawal_code, get_commander_revshare_balance,
handle_brokerage_commission, handle_manual_deposit_approval, record_pool_entry,
redeem_cash_withdrawal_code, settle_cash_ride, admin_get_band_revshare,
admin_get_merchant_billing_overview, admin_get_organizer_revshare,
admin_get_pending_revshare, admin_get_reserve_balance`.
