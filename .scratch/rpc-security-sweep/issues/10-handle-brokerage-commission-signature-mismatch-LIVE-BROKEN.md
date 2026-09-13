# `handle_brokerage_commission` signature + return-shape mismatch — dealer brokerage invoicing has never fired

Status: ready-for-human (live production bug, not a hardening item)

## What

Real caller (`supabase/functions/dealer_brokerage/index.ts:269-270`,
fresh-read 2026-08-13):

```ts
const { data: commissionResult } = await supabaseAdmin
  .rpc("handle_brokerage_commission", { p_sale_id: sale_id });

if (commissionResult?.brokerage_fee_cents > 0) {
  updateData.brokerage_fee_cents = commissionResult.brokerage_fee_cents;
  updateData.brokerage_invoice_id = commissionResult.invoice_id;
}
```

Deployed function:

```sql
CREATE OR REPLACE FUNCTION public.handle_brokerage_commission(
  p_sale_id uuid, p_dealer_id uuid, p_amount_cents integer
) RETURNS void ...
```

Two independent mismatches, not one:
1. **Parameters**: caller passes only `p_sale_id`; the function requires
   `p_dealer_id` and `p_amount_cents` with no defaults. PostgREST can't
   resolve the call — every invocation fails.
2. **Return shape**: even if the parameters matched, the caller expects
   a `jsonb` object (`{ brokerage_fee_cents, invoice_id }`); the function
   `RETURNS void`. `commissionResult` would always be `undefined`.

The failure is silent to the end user — `commissionResult` destructures
to `undefined` either way, `commissionResult?.brokerage_fee_cents > 0`
is `undefined > 0` (`false`), so the `if` block simply never runs. No
error is thrown or logged (the caller doesn't check for an `error` on
the RPC response at all here).

## Real-world impact

Found: 0 rows in `wallet_transactions` with `transaction_type =
'brokerage_commission'` ever. **No dealer has ever received a brokerage
commission credit or invoice through this path.** Whether this has cost
real money depends on whether any real vehicle sale has gone through
`dealer_brokerage`'s financing-approval step — not checked here, out of
scope for this pass — but the function has certainly never worked as
designed.

## Fix, when picked up — this is a design question, not a signature fix

The deployed function doesn't compute a fee or generate an invoice at
all; it takes `p_amount_cents` as a given and just logs + credits it.
The real caller wants `handle_brokerage_commission` to:
1. Look up the sale (`p_sale_id`) to determine the dealer
   (`p_dealer_id` should be derived from the sale record, not passed in
   — the caller doesn't have it) and compute the brokerage fee itself
   (from the sale price and whatever commission-rate rule applies —
   confirm against `dealer_partners` or a pricing_config key).
2. Create an actual invoice record and return its id, plus the computed
   fee, as `jsonb` — matching what `dealer_brokerage/index.ts` reads
   back (`brokerage_fee_cents`, `invoice_id`).

This is closer to "the function was never finished" than "the function
drifted" — recommend treating it as a scoped feature-completion task,
not a one-line signature patch. Confirm the fee-calculation rule and
invoice-table shape with whoever owns the dealer brokerage feature
before writing the migration.
