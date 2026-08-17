# `admin_wallet_adjust` inserts an invalid `transaction_type` — refunds are completely broken today

Status: ready-for-human (live production bug, not a hardening item — different priority class from the rest of this pass)

## What

`admin_wallet_adjust(p_user_id, p_amount_cents, p_reason, p_admin_id)` always inserts:

```sql
INSERT INTO public.wallet_transactions (user_id, amount, transaction_type, status, description)
VALUES (p_user_id, p_amount_cents, 'admin_adjustment', 'completed', 'Admin Adjustment: ' || p_reason);
```

`'admin_adjustment'` is **not a valid value** in the live
`wallet_transactions_transaction_type_check` CHECK constraint. Every real
call fails with a `23514` constraint violation. Confirmed via
`pg_stat_statements`: **zero rows have ever successfully inserted with
this transaction_type** — this has never worked, not even once.

Found as a side effect of fixing this function's separate identity-check
bug (2026-08-12 hardening pass, see `PRD.md` and `00-SWEEP-SUMMARY.md`)
— not something that pass was scoped to fix, flagged separately per
instruction.

## Real-world impact

The only real caller is `supabase/functions/admin/index.ts`'s `'refund'`
action (`apps/admin/src/pages/Support.tsx` → admin refund flow). **Every
admin-initiated ride refund and every driver payout clawback has failed
silently at this constraint since this function was written.** The edge
function does surface the RPC error for the primary refund call
(`if (rpcError) throw rpcError`), so the admin sees a failed request —
this is not a silent-data-loss bug, it's a completely non-functional
feature that's presumably been throwing errors at whoever has tried to
use it.

## Before fixing: this needs TWO transaction types, not one

The same caller invokes this function with **two different semantic
shapes**, confirmed by re-reading `admin/index.ts` fresh (not assumed):

```ts
// 1. Refund credit to the RIDER — always positive
await supabaseAdmin.rpc('admin_wallet_adjust', {
  p_user_id: ride.rider_id, p_amount_cents: ride.total_fare_cents,
  p_reason: 'REFUND RIDE ' + ride_id + ..., p_admin_id: user.id,
})

// 2. Clawback debit from the DRIVER — always negative
await supabaseAdmin.rpc('admin_wallet_adjust', {
  p_user_id: d.user_id, p_amount_cents: -payoutAmount,
  p_reason: 'CLAWBACK: driver payout reversed for refund of ride ' + ride_id,
  p_admin_id: user.id,
}).then(null, () => {})
```

A fix that just swaps `'admin_adjustment'` for the existing `'refund'`
enum value would be **wrong for the second call** — a driver payout
reversal is not a refund, and mislabeling it corrupts financial
reporting (revenue/payout reconciliation would read a driver clawback as
a rider refund).

No other real callers exist anywhere in `supabase/functions/` or `apps/`
(verified via repo-wide grep) — so the full set of real shapes to
support is exactly these two.

## Fix, when picked up

Two real options, not "just pick a string":

1. **Two valid transaction_type values** — use `'refund'` for the
   positive rider-credit case, and a debit-appropriate type for the
   clawback (closest existing semantic match in the live enum is
   `'debt_recovery'` — recovering money already paid out — or extend the
   enum with something explicit like `'payout_clawback'`; confirm
   against how downstream reporting/reconciliation code reads
   `transaction_type` before picking). The function would need to derive
   which type applies from the call context (e.g. an explicit
   `p_transaction_type` parameter validated against an allowlist, since
   inferring purely from `sign(p_amount_cents)` conflates "refund" with
   "any positive adjustment").
2. **Split into two functions** — `admin_refund_rider` and
   `admin_clawback_driver_payout` — clearer intent, no branching on sign
   inside one generic "adjust" function. Given `admin_wallet_adjust`'s
   only real caller already treats these as two distinct operations
   with two distinct reasons, this may be the more honest fix.

Either way: read the live `wallet_transactions_transaction_type_check`
enum before writing the migration (don't assume `'refund'` is
sufficient — that assumption is exactly what caused this thread), dry-run
both call shapes in a rolled-back transaction against real ride/driver
rows, apply via migration, then live-verify by exercising the actual
`admin/index.ts` `'refund'` action end-to-end (or the closest safe
equivalent) — not just a bare RPC call — since this is the first time
this code path will have ever actually succeeded.
