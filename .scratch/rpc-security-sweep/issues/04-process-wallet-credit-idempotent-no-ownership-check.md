# `process_wallet_credit_idempotent` — no ownership check, no amount-sign check

Status: ready-for-agent (not urgent — currently unreachable via API)

## What

`process_wallet_credit_idempotent(p_user_id, p_amount_cents, p_reference_id, p_provider)`:

- Takes `p_user_id` directly from the caller with no `auth.uid()` check.
- Does not validate `p_amount_cents > 0`.

Currently `anon_exec=false`, `auth_exec=false` — not reachable via the
API today, so not an active hole. But it's the most dangerous shape found
in the whole sweep if it were ever exposed: a **negative**
`p_amount_cents` creates a negative `topup` transaction against an
arbitrary `p_user_id`, which reads as a legitimate-looking wallet debit
("Wallet top-up via `<provider>`") against a victim who never authorized
it — silent theft disguised as a top-up, not just a triggered-early
legitimate action like the rest of today's findings.

Also flips `drivers.is_online = true` for an arbitrary `p_user_id` as a
side effect if the resulting balance clears -30000 cents — a caller
could remotely force any driver online.

## Fix, when picked up

- `IF p_amount_cents <= 0 THEN RETURN FALSE` (or raise) before anything else.
- If this is ever meant to be reachable by a user for their own account,
  add `IF p_user_id != auth.uid() THEN RETURN FALSE`. If it's meant to
  stay payment-provider-webhook-only, leave ungranted but add the
  amount-sign check regardless — defense in depth costs nothing here.
