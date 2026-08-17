# `process_payout_request` has the `drivers.id != auth.uid()` bug

Status: ready-for-agent (not urgent — currently unreachable via API)

## What

`process_payout_request(p_request_id, p_action, p_admin_id, p_reason)`
reads `payout_requests.driver_id` and uses it directly as
`wallet_transactions.user_id`:

```sql
SELECT COALESCE(SUM(amount), 0) INTO v_balance
FROM public.wallet_transactions
WHERE user_id = v_req.driver_id AND status = 'completed';
...
INSERT INTO public.wallet_transactions (user_id, ...)
VALUES (v_req.driver_id, ...);
```

`payout_requests.driver_id` is a foreign key to `drivers.id`
(`payout_requests_driver_id_fkey`), not to `auth.users.id`. Every real
`wallet_transactions.user_id` is the driver's auth uid
(`drivers.user_id`), not `drivers.id`. Same class of bug found and fixed
today in `request_driver_payout` and `request_cash_withdrawal`.

If this function is ever wired up (currently `anon_exec=false`,
`auth_exec=false`, unreachable via API — this is a correctness bug, not
a live security hole), every balance check and every debit would target
the wrong row: a `wallet_transactions.user_id` value that happens to
equal a `drivers.id`, which is never a real driver's actual balance.

## Why not fixed today

Not reachable via the API — no urgency, and this function may be
superseded dead code from before `fulfill_driver_payout` was built
today (same purpose, correct identity handling). Confirm which is
actually meant to be the live path before touching either.

## Fix, when picked up

Resolve `v_driver_uid` via `SELECT user_id FROM drivers WHERE id =
v_req.driver_id` before touching `wallet_transactions`, same pattern as
`fulfill_driver_payout`. Or: confirm this function is dead and drop it.
