# Batch C, Group 2 final sub-group + a coverage gap caught during reconciliation

Status: needs-triage

## Final 15-function sub-group

All confirmed `anon_exec=false, auth_exec=false`, zero real anon/authenticated
calls ever (`pg_stat_statements`).

**Worth flagging (inert, dangerous if ever granted):**

- **`generate_cash_withdrawal_code(p_user_id, p_driver_id, ...)`** — a
  full two-step theft chain, not just a single-function gap. Both
  `p_user_id` (debit target) and `p_driver_id` (who the resulting cash
  code pays out to) are caller-supplied with no `auth.uid()` check.
  Chained with `redeem_cash_withdrawal_code` (below), an attacker could:
  call `generate_cash_withdrawal_code(victim_id, attacker_driver_id, amount, 0)`
  to debit a victim's wallet and mint a code tied to the attacker's own
  driver row, then redeem that code as themselves to receive the real
  payout. `redeem_cash_withdrawal_code` itself is comparatively sound —
  the credit target is fixed at generation time
  (`v_code_record.driver_id`), not re-selectable at redemption — so the
  entire exploit surface is on the generate side. Flag both together;
  fix belongs on `generate_cash_withdrawal_code` only
  (`p_user_id = auth.uid()` check).
- **`handle_brokerage_commission(p_sale_id, p_dealer_id, p_amount_cents)`**
  — arbitrary dealer, arbitrary amount, no ownership check, no
  idempotency on `p_sale_id`.
- **`admin_get_pending_revshare(p_ledger_type)`** — the only one of the
  five `admin_get_*` reporting functions **without** an admin-role
  check. Its four siblings (`admin_get_band_revshare`,
  `admin_get_organizer_revshare`, `admin_get_merchant_billing_overview`,
  `admin_get_reserve_balance`) all correctly gate on
  `profiles.role = 'admin'` via `auth.uid()`; this one has no gate at
  all. Read-only (aggregates pending revshare per organizer/band), so
  the exposure is financial-summary disclosure, not fund movement — but
  it's an inconsistency with an established, already-correct sibling
  pattern, which makes it look like an oversight rather than a
  deliberate choice.
- **`get_commander_revshare_balance(p_commander_id)`** — read-only, but
  has a real correctness bug independent of auth: the second `SELECT
  ... INTO v_total` (meant to subtract already-requested payouts per its
  own comment, "Subtract any already-requested but pending payouts")
  **overwrites** `v_total` instead of subtracting from it, discarding
  the first sum entirely. The function returns "pending payout requests
  total," not "pending revshare minus pending payouts" as documented.
  Not a security issue, but flagged since it would misinform whoever
  reads it (admin dashboard or commander self-service, once wired up).

**Confirmed fine as-is:**
- `driver_qualifies_loyalty_rate`, `check_driver_debt_limit` — read-only.
- `expire_stale_withdrawal_codes`, `apply_lease_daily_fees` (both
  overloads) — cron sweeps, process every eligible row uniformly, no
  caller-supplied target.
- `fn_auto_reactivate_driver`, `handle_manual_deposit_approval` —
  trigger functions (`RETURNS trigger`), unreachable via RPC/PostgREST
  regardless of grant, consistent with every other trigger function
  found in this sweep.
- `record_pool_entry` — retired no-op (`RETURN;` only), dead code, zero
  risk regardless of grant.
- `settle_cash_ride(p_ride_id)` — driver resolved from the ride's real
  `driver_id`, not caller-supplied; nested calls to `compute_ride_split`
  and `record_ride_kickbacks` already confirmed ungranted in earlier
  batches. Correct shape.
- `admin_get_band_revshare`, `admin_get_organizer_revshare`,
  `admin_get_merchant_billing_overview`, `admin_get_reserve_balance` —
  all four correctly gate on `auth.uid()` + admin role.

## Coverage gap caught during final reconciliation

Re-deriving the full money-touching function universe (scanning every
function body for references to `wallet_transactions`, `payout_requests`,
`wallets`, and the 7 ledger tables) to confirm 100% sweep coverage
surfaced **3 functions that were never checked** in this sweep — missed
because they weren't on the Group 2 list handed off between sub-groups:

- **`deduct_wallet_balance(p_user_id, p_amount_cents, p_reason,
  p_order_id)`** — `p_user_id` fully caller-supplied, no `auth.uid()`
  check, no role gate. Same shape as every other flagged debit-primitive
  this session. `anon_exec=false, auth_exec=false`, zero real calls
  (now confirmed).
- **`rider_wallet_payment(p_user_id, p_merchant_id, p_amount_cents,
  p_merchant_name)`** — near-identical to `merchant_wallet_charge`
  (fixed earlier today) but arguably **more dangerous if ever exposed**:
  `merchant_wallet_charge` at least requires knowing a physical NFC
  `tag_uid` to identify the victim; this one takes `p_user_id` directly,
  and user ids are far more discoverable in this app (visible in ride
  history, chat, driver-rider pairing) than NFC tag UIDs. No
  `auth.uid()` check despite the name implying rider self-service.
  `anon_exec=false, auth_exec=false`, zero real calls confirmed.
- **`g_spot_renew_memberships()`** — cron sweep, no caller-supplied
  target (processes every membership due for renewal). Confirmed fine,
  same shape as the other correctly-built sweeps.

None of the three were reachable — same "inert, not urgent" status as
everything else in this file — but this is the coverage gap the closing
summary needs to account for honestly rather than silently absorb.
**With these three, Group 2's function list is now fully closed with no
further known gaps** (re-verified against a fresh scan of every
function body referencing the money tables, not just the hand-carried
list).

## Fix, when picked up

Same pattern as every other inert finding this session:
`IF p_user_id/p_dealer_id IS DISTINCT FROM auth.uid() THEN return
unauthorized` for the caller-supplied-target functions
(`generate_cash_withdrawal_code`, `handle_brokerage_commission`,
`deduct_wallet_balance`, `rider_wallet_payment`); add the standard
admin-role gate to `admin_get_pending_revshare` to match its four
siblings; fix the double-`SELECT INTO` bug in
`get_commander_revshare_balance` to actually subtract instead of
overwrite.
