# RPC/RLS security sweep — money-touching functions

## Context

2026-08-11: while fixing a broken `request_driver_payout` RPC (missing
`user_id` column, INSERT failed on every call), the same investigation
found two functions callable via the public API with no internal auth
check at all: `bind_fleet_lease_insurance` and
`execute_escape_group_confirmation`. Both fixed same day
(`REVOKE EXECUTE ... FROM anon, authenticated`).

That pattern — a function written to be system/cron-only, but the grant
never locked down to match — is now the working hypothesis for where the
next real hole is. A full sweep of all money-touching functions
(`payout_requests`, `wallets`, `wallet_transactions`, and the 7 ledger
tables) is underway, batched by risk:

- **Batch A** (name contains payout/withdraw/debit/disburse/refund/credit):
  done, 2026-08-11. No new critical/high findings.
- **Batch B** (cron-triggered functions): done, 2026-08-11. 4 fixed.
- **Batch C** (everything else): done, 2026-08-12. 68 distinct functions
  checked total across the whole sweep (100% of the re-derived
  money-touching universe, see closing summary). 4 more real fixes in
  Group 2 (2 CRITICAL). Full results: `00-SWEEP-SUMMARY.md`.

**Sweep closed 2026-08-12.** See `00-SWEEP-SUMMARY.md` for the full
closing report: coverage confirmation, every fix with severity, every
inert-but-dangerous finding left on file, the zero-exploitation
evidence, and the standing checklist for future money-touching
functions.

## Method (repeat for every function in scope)

1. `anon_exec` / `auth_exec` via `has_function_privilege` — flag anything
   `true` that isn't clearly meant to be public.
2. Read the function body via `pg_get_functiondef`. Does it check
   `auth.uid()` against the row it's touching, or is the grant the only
   gate?
3. Real call history: `pg_stat_statements` joined to `pg_authid` on
   `userid`, filtered to the function name. Confirms actual blast radius
   (which role has really been calling it) before deciding severity.

Every fix: dry-run in a rolled-back transaction first, then apply via
`apply_migration`, then live-probe with the real anon key to prove the
fix, not just re-read the grant.
