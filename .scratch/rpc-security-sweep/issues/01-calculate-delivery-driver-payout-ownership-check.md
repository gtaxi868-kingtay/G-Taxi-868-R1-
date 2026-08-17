# `calculate_delivery_driver_payout` + `calculate_delivery_merchant_cut` have no ownership check

Status: wontfix (resolved 2026-08-13 — revoked instead of ownership check, see below)

## Resolution (2026-08-13)

Fixed by revoking `anon`/`authenticated`/`PUBLIC` execute grants rather
than adding the ownership check originally sketched below. Re-checked
real callers fresh: no direct client-side or edge-function caller exists
anywhere in `apps/` or `supabase/functions/` for either function — both
are only ever invoked as nested `SECURITY DEFINER` calls inside
`process_order_delivery_payment`/`process_cash_delivery_settlement`,
which already run under a service-role context. A nested call executes
under that context regardless of the leaf's own grant (the Batch B
lesson), so revoke is a safe, complete no-op against every real caller —
and closes the info-disclosure surface outright rather than gating it by
an ownership join that isn't needed. Live-verified via real anon-key
REST probes: both now return `401 permission denied`.

## What

Two sibling functions, same shape, same gap:

- `calculate_delivery_driver_payout(p_order_id uuid)`
- `calculate_delivery_merchant_cut(p_order_id uuid)`

Both `SECURITY DEFINER`, both `auth_exec = true`, both take `p_order_id`
with no check that the caller owns or is assigned to that order. Any
authenticated user (rider, driver, merchant — anyone with a session) can
compute the delivery payout estimate AND the merchant's financial cut
(goods subtotal, merchant cut, platform cut) for any order in the system
by guessing/enumerating order UUIDs.

Found: 2026-08-11, during the money-function RPC sweep. Full sweep
context: `.scratch/rpc-security-sweep/PRD.md`. `calculate_delivery_merchant_cut`
found via bidirectional tracing (Batch C) as a nested call inside
`process_cash_delivery_settlement` / `process_order_delivery_payment` —
same gap, filed together rather than duplicated.

## Why it's low severity, not urgent

- **Both read-only.** Neither function body contains any `INSERT`/`UPDATE`/
  `DELETE` — they only read `orders`/`merchants`/`pricing_config` and
  return a computed table. No money moves, no row changes.
- Leaks: computed delivery distance/payout estimate, and separately the
  full merchant financial breakdown (subtotal, merchant cut, platform
  cut), for an order that isn't the caller's. Order UUIDs are not
  sequential/guessable in practice.
- Not part of any critical launch path.

## The fix

One-line addition near the top of the function body:

```sql
IF NOT EXISTS (
  SELECT 1 FROM orders o
  JOIN drivers d ON d.id = o.driver_id
  WHERE o.id = p_order_id AND d.user_id = auth.uid()
) THEN
  RETURN; -- or raise, matching the table-returning convention already used
END IF;
```

Confirm the real join path from `orders` to the assigned driver's
`auth.uid()` via `information_schema` before writing this — don't assume
`orders.driver_id` is `drivers.id` vs a direct auth uid without checking,
per this repo's own `drivers.id != auth.uid()` gotcha (already hit twice
in this sweep).

## Verification

1. Dry-run in a rolled-back transaction against a real order row.
2. Live-probe via the anon/authenticated REST RPC endpoint with a driver
   account that does NOT own the test order — confirm it's rejected.
3. Confirm the legitimate caller (the assigned driver, or whatever admin
   flow currently calls this) still gets a result.
