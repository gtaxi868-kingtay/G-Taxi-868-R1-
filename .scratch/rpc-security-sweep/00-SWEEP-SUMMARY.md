# RPC/RLS security sweep — closing summary (2026-08-11 → 2026-08-12)

## 1. Coverage

Original scope estimate at kickoff: ~62 money-touching functions. That
number was a working estimate, not a derived count — at closeout, the
universe was re-derived directly from Postgres rather than carried
forward from memory: every `public` function whose body references
`wallet_transactions`, `payout_requests`, `wallets`, or any of the 7
ledger tables (`capital_reserve_ledger`, `transit_financial_ledger`,
`ecosystem_pool_ledger`, `payment_ledger`, `band_revshare_ledger`,
`event_revshare_ledger`, `commander_revshare_ledger`).

That scan returned **61 distinct function names** (62 rows —
`apply_lease_daily_fees` has two overloads). All 61 were checked in
this sweep. A further **7 functions** were checked that fall outside a
literal table-name scan (dispatchers/read-only calculators that don't
write to a money table directly, or were found via cron
cross-reference rather than table reference): `process_nfc_payment`,
`calculate_delivery_driver_payout`, `calculate_delivery_merchant_cut`,
`compute_ride_split`, `escape_sweep_tipping_points`,
`promote_escape_transfer_rides`, `scout_sweep_zones`.

**Total: 68 distinct functions checked. 100% of the re-derived universe
covered.**

One real gap was caught and closed during this process, not before:
`deduct_wallet_balance`, `rider_wallet_payment`, and
`g_spot_renew_memberships` were absent from the hand-carried Group 2
list (they weren't in the original ~62 estimate) and were only found by
re-running the table-reference scan at closeout. All three were then
checked to the same standard as everything else — see
[issues/07](issues/07-batch-c-group-2-final-and-coverage-gap.md). This
is reported here as evidence the reconciliation step earns its place,
not as a footnote to bury.

## 2. Functions FIXED today — what was actually broken

| Function | Severity | Fix |
|---|---|---|
| `process_cash_delivery_settlement` | CRITICAL | Revoked anon/authenticated — caller-supplied driver id could redirect delivery settlement to an arbitrary driver |
| `merchant_wallet_charge` | CRITICAL | Revoked anon/authenticated — any signed-in user could debit up to TT$2,000 from any rider's wallet by NFC tag and route it to any merchant |
| `spend_from_reserve` | CRITICAL | Revoked anon/authenticated — any signed-in user could drain the capital reserve into an arbitrary wallet with zero ownership check; platform-vs-user exposure, not user-vs-user |
| `process_order_delivery_payment` | HIGH | Revoked anon/authenticated |
| `escape_sweep_tipping_points` | HIGH | Revoked anon/authenticated — force-confirms flight blocks and creates real rides/wallet credits |
| `apply_referral_code` | HIGH | Added internal check (`p_referee_id = auth.uid()`) — grant was load-bearing (called client-side from `SignupScreen.tsx`), so a bare revoke would have broken signup; any signed-in user could otherwise farm TT$15 credits against arbitrary victim ids |
| `resolve_identity_tag` | MEDIUM | Added internal check (caller must own/staff an active merchant row) — grant was load-bearing (called client-side from the merchant-mobile NFC screen); any signed-in user could otherwise resolve a rider's name + wallet balance from a guessed tag |
| `compute_ride_split` | MEDIUM (info-only) | Revoked anon/authenticated — read-only fare-split disclosure |
| `promote_escape_transfer_rides` | MEDIUM | Revoked anon/authenticated |
| `process_merchant_billing` | LOW | Revoked anon/authenticated — feature-flag gated, effectively idempotent |
| `scout_sweep_zones` | LOW | Revoked anon/authenticated — writes advisory-only rows |
| `bind_fleet_lease_insurance` | — (pre-sweep, same day) | Revoked anon/authenticated |
| `execute_escape_group_confirmation` | — (pre-sweep, same day) | Revoked anon/authenticated |
| `request_driver_payout` | — (pre-sweep, same day) | Fixed `drivers.id` vs `auth.uid()` identity bug |
| `request_cash_withdrawal` | — (pre-sweep, same day) | Fixed the same identity bug, including my own same-day regression on `p_wallet_user_id` |
| `process_wallet_debit_hardened` | — (pre-sweep, same day) | Fixed |
| `fulfill_driver_payout` (new) | — (pre-sweep, same day) | Built as a proper atomic RPC to replace an unsafe non-transactional JS update in the payout edge function |

Every fix: dry-run in a rolled-back transaction, applied via
`apply_migration`, then live-verified — either a real anon-key REST
probe returning `401 permission denied` (grant revocations), or a
rolled-back transaction simulating an authenticated-but-unauthorized
caller via `SET LOCAL role authenticated` + a spoofed
`request.jwt.claims.sub` (internal-check additions), confirming the new
check rejects impersonation while the real caller's path is untouched.

## 3. Functions FLAGGED but left inert — don't touch without rechecking

All of these are `anon_exec=false, auth_exec=false` today, confirmed
zero real calls ever. Read this list before extending or granting any
of them.

**Worst-case CRITICAL the moment they're granted:**
- `credit_wallet` — raw credit/debit primitive: caller-supplied user,
  caller-supplied amount, no sign check, no auth check at all.
- `deduct_wallet_balance` / `rider_wallet_payment` — same shape as
  `merchant_wallet_charge`, but keyed on a directly-discoverable
  `p_user_id` rather than a physical NFC tag — arguably higher risk if
  ever exposed than the one that was actually live today.
- `charge_escape_participant_wallet` — arbitrary debit with no anchor
  to a real reservation or price.
- `admin_wallet_adjust` — its "admin check" verifies a **caller-supplied
  parameter** (`p_admin_id`) against the role table instead of
  `auth.uid()`. This exact shape was searched for specifically per
  standing instruction and did not repeat elsewhere in the remaining
  functions.
- `generate_cash_withdrawal_code` chained with
  `redeem_cash_withdrawal_code` — a full two-step theft chain (debit an
  arbitrary victim, mint a code payable to an attacker-controlled
  driver, redeem it).
- `book_travel_atomic` — no ownership check on the wallet-debit target.

**MEDIUM-HIGH:**
`credit_merchant_commission`, `handle_brokerage_commission` (arbitrary
recipient + amount, no idempotency), `check_driver_referral_commission`
(no idempotency, amplifiable), `capture_escape_wallet_payment` (anchored
to a real reservation but caller isn't verified against it),
`admin_process_kickback_payout` / `admin_process_revshare_payout`
(unverified `p_admin_id`, but only flips ledger status — bookkeeping
risk, not direct theft).

**Correctness bugs, not security holes:**
`get_commander_revshare_balance` (a double `SELECT INTO` overwrites
instead of subtracting — returns the wrong number, always has),
`process_payout_request` (`drivers.id` vs `auth.uid()` bug, same class
already fixed twice live elsewhere), `process_wallet_credit_idempotent`
(no amount-sign check — the single function to check first if scope
ever changes on anything wallet-adjacent), `calculate_delivery_driver_payout`
+ `calculate_delivery_merchant_cut` (no ownership check, but read-only),
`admin_get_pending_revshare` (missing the admin-role check its four
sibling `admin_get_*` functions all have — info disclosure only).

Full detail and fix sketches for every item above:
`.scratch/rpc-security-sweep/issues/`.

## 4. Zero real-world exploitation — the actual verified fact

Every finding in this sweep, CRITICAL through LOW, was checked against
`pg_stat_statements` joined to `pg_authid` on `userid`, filtered to
`anon`/`authenticated` roles, before any severity was assigned or any
fix applied. **Not one flagged function shows a single real call from
`anon` or `authenticated` in the query-plan cache.** This means every
CRITICAL/HIGH finding — including `merchant_wallet_charge` and
`spend_from_reserve`, the two most severe — was a real, live-reachable
hole that had simply never been found or used, not an active incident
with a victim. This is restated as the checked fact it is, not as
reassurance.

## 5. The one process lesson worth keeping permanently

**A nested `SECURITY DEFINER` call runs under the *owner* of the
function it's nested inside, not under the original caller's
privileges.** This means revoking a leaf function's grant does not
protect it if it can still be reached through an unprotected wrapper
higher in its own call chain — first found with
`escape_sweep_tipping_points` (Batch B), which remained reachable
through a caller even after a related leaf function had already been
locked down earlier the same day.

The practical consequence: every grant check in this sweep required
tracing **both directions** — what calls this function (edge functions
via `grep supabase/functions/`, client apps via `grep apps/`,
`pg_cron.job`, and other `SECURITY DEFINER` bodies) and what this
function calls (any nested `SECURITY DEFINER` invocation needs its own
independent grant check, because it doesn't inherit the caller's
restrictions). A same-looking `auth_exec=true, no internal check` grant
split into opposite correct fixes twice today
(`merchant_wallet_charge`/`spend_from_reserve` needed a revoke;
`resolve_identity_tag`/`apply_referral_code` needed an internal check
instead) — the only way to tell which was which was finding the real
caller in `apps/`, not just `supabase/functions/`.

## 6. Before you write the next money-touching function

Derived from every root cause found in this sweep — read this before
adding a new `SECURITY DEFINER` function that touches
`wallet_transactions` or any ledger table:

1. **Every parameter that names a user and will be used as a debit/credit
   target, or as a permission check, must be verified against
   `auth.uid()` directly.** Never trust a parameter as if it were
   already-verified identity — `admin_wallet_adjust`'s bug was exactly
   this: it checked a caller-supplied `p_admin_id` against the admin
   role table instead of checking `auth.uid()`.
2. **Never gate a privileged action on a caller-supplied ID compared to
   a role table.** The identity check must originate from the session
   (`auth.uid()`), never from an argument.
3. **Validate amount sign/range on any function meant to only ever move
   money in one direction.** A "credit" function with no sign check is
   an arbitrary-debit primitive the moment someone grants it —
   `process_wallet_credit_idempotent` and `credit_wallet` both have this
   gap today, inert only because nothing has granted them yet.
4. **If a function is system/cron/service-role-only, don't leave it on
   the default `authenticated` grant.** Explicitly revoke from
   `anon, authenticated, PUBLIC`, then explicitly grant only to
   `service_role`. Several of today's holes existed purely because this
   step was skipped at creation time, not because anyone deliberately
   opened them.
5. **If a function is meant to be called directly by a client app with
   the user's own JWT, the internal ownership check is not optional.**
   The grant is binary (all authenticated users, or none) — it cannot
   express "only this row's owner." Two of today's real fixes
   (`resolve_identity_tag`, `apply_referral_code`) needed this because
   the grant itself was legitimately required.
6. **Any function that mutates money state keyed on a caller-supplied
   reference (order id, ride id, sale id) should be idempotent** —
   check for an existing completed transaction against that reference
   before inserting a new one. Several inert findings today had no such
   guard and could mint unlimited commission/credit if ever called
   twice.
7. **Trace the call graph in both directions before granting anything.**
   What calls this function, and what does it call. A nested `SECURITY
   DEFINER` call executes under its own owner's context regardless of
   the grant on the function that invoked it.
8. **Dry-run in a rolled-back transaction, then live-verify — never
   just re-read the grant.** A real anon-key REST probe (for grant
   changes) or a rolled-back transaction with `SET LOCAL role
   authenticated` + a spoofed `request.jwt.claims.sub` (for internal
   ownership checks) is what actually proves a fix, not the migration
   applying cleanly.
9. **Before revoking any grant, find the real legitimate caller —
   `grep` both `supabase/functions/` and the client apps under `apps/`,
   not just one of the two.** Whether it's service-role (revoke is
   safe) or user-JWT-scoped (revoke breaks production, fix needs an
   internal check instead) determines which fix is correct, and the two
   look identical from the grant alone.
