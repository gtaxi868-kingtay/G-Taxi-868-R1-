# Batch B: cron-only functions had excess grants — fixed 2026-08-11

Status: wontfix (resolved, keeping as record)

## What was found

Cross-referenced `pg_cron.job` against the money-touching function
universe. Four `SECURITY DEFINER` functions meant to be cron-only carried
`anon_exec=true AND auth_exec=true` with zero internal auth check:

- `escape_sweep_tipping_points` (HIGH) — force-confirms flight blocks,
  creates real rides, credits wallet_transactions. Reachable even after
  the `execute_escape_group_confirmation` fix earlier the same day,
  because nested `SECURITY DEFINER` calls run under the *outer*
  function's owner context, not the original caller's — a wrapper one
  level up the call chain re-opens a door already closed on the leaf.
- `promote_escape_transfer_rides` (MEDIUM) — flips ride status
  system-wide ahead of schedule. No fund movement, real dispatch-timing
  mutation.
- `process_merchant_billing` (LOW) — feature-flag gated, no caller
  targeting, effectively idempotent. Locked for consistency, not because
  it was independently exploitable.
- `scout_sweep_zones` (LOW) — writes advisory-only proposal rows, no
  commander/merchant onboarded without admin approval.

All four: zero real anon/authenticated calls ever (confirmed via
`pg_stat_statements` joined to `pg_authid`). All fixed via
`REVOKE EXECUTE ... FROM anon, authenticated, PUBLIC`, dry-run verified
first, then live-probed with the real anon key post-apply (all four
returned `401 permission denied`).

## The standing principle this established

**Revoking a leaf function's grant does not protect it from being reached
through an unprotected wrapper further up its own call chain.** Every
independently-reachable entry point in a call graph needs checking, not
just the deepest function that does the actual write. Carry this into
Batch C: for any function found with excess grants, check what calls it
AND what it calls, not just the function in isolation.
