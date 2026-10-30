-- =============================================================================
-- 20261030100000_nfc_charge_hardening.sql
-- NFC CHARGE HARDENING — rider-authorised, single-use, amount-bound tap charges
-- (Fix wave 3A of the function register, group 4: merchant_nfc_charge DEFECT)
--
-- THE HOLE THIS CLOSES
--   merchant_nfc_charge charged a rider's wallet from nothing but the rider's
--   static identity-tag UID plus a merchant-chosen amount. The tag UID is a
--   bearer credential printed as a QR/URL: anyone who ever saw it could replay
--   charges through any merchant account, any number of times, and the
--   merchant_wallet_charge RPC had no nonce, dedupe or consent check either.
--
-- THE FIX (this file + the merchant_nfc_charge / rider_nfc_pay functions)
--   A charge must present a session the RIDER created while signed in:
--     1. Rider creates a session (rider_nfc_pay, action=create_charge_session):
--        bound to (rider, merchant, amount), lives 5 minutes.
--     2. Merchant presents the session id (merchant_nfc_charge). The amount
--        comes ONLY from the session — never from the merchant's request.
--     3. merchant_wallet_charge_authorised consumes the session under a row
--        lock: exactly one debit ever happens. A replayed charge returns the
--        FIRST charge's recorded result (idempotent), never a second debit.
--   The static tag UID is no longer a payment credential anywhere in this path.
--
-- COMMISSION — INTENTIONALLY UNCHANGED, FOUNDER RULING NEEDED
--   The locked economics (28 Oct 2026) set takes for shop GOODS orders
--   (direct 0%, marketplace 5/10/8%) and for the delivery leg. No rate exists
--   anywhere in the locked economics or pricing_config for a wallet tap
--   charge, so this migration does NOT invent one: the merchant owner is
--   still credited the full amount, exactly as merchant_wallet_charge does
--   today. Flagged for Taylor's ruling before/with this migration's rollout.
--
-- ALSO IN THIS FILE
--   A partial unique index that makes nfc_event_handler's nonce replay guard
--   race-proof (one consumed nonce per profile).
--
-- NOT APPLIED by the author — apply centrally after review. The legacy
-- merchant_wallet_charge RPC is deliberately left in place (it becomes
-- uncalled by the edge function once this ships); retiring or revoking it
-- is a separate, explicit decision.
-- =============================================================================

-- ── 1. Charge sessions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nfc_charge_sessions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id            uuid NOT NULL REFERENCES public.profiles(id),
    merchant_id         uuid NOT NULL REFERENCES public.merchants(id),
    amount_cents        integer NOT NULL CHECK (amount_cents > 0),
    status              text NOT NULL DEFAULT 'authorised'
                        CHECK (status IN ('authorised', 'consumed', 'expired', 'cancelled')),
    transaction_id      uuid,
    rider_balance_after integer,
    created_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
    consumed_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_nfc_charge_sessions_merchant
    ON public.nfc_charge_sessions (merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_nfc_charge_sessions_rider
    ON public.nfc_charge_sessions (rider_id, status);

-- Service role only: the table is reachable exclusively through the two
-- SECURITY DEFINER functions below, called by edge functions. RLS is on and
-- no policies are granted, so anon/authenticated clients can neither read a
-- session (which would leak who is about to pay whom, and how much) nor
-- forge one.
ALTER TABLE public.nfc_charge_sessions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.nfc_charge_sessions IS
    'Single-use, amount-bound authorisations for merchant tap charges. '
    'Created by the rider (rider_nfc_pay), consumed exactly once by '
    'merchant_wallet_charge_authorised. A consumed session replays its '
    'recorded result instead of charging again.';

-- ── 2. Session creation (rider-side) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_nfc_charge_session(
    p_rider_id     uuid,
    p_merchant_id  uuid,
    p_amount_cents integer
)
RETURNS TABLE(
    success       boolean,
    error_message text,
    session_id    uuid,
    merchant_name text,
    amount_cents  integer,
    expires_at    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_merchant_name text;
  v_session_id    uuid;
  v_expires_at    timestamptz := now() + interval '5 minutes';
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RETURN QUERY SELECT FALSE, 'Invalid amount: must be positive',
      NULL::uuid, NULL::text, NULL::integer, NULL::timestamptz;
    RETURN;
  END IF;

  -- Same per-transaction ceiling the legacy charge RPC enforced.
  IF p_amount_cents > 200000 THEN
    RETURN QUERY SELECT FALSE, 'Amount exceeds maximum of TTD $2,000.00 per transaction',
      NULL::uuid, NULL::text, NULL::integer, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT name INTO v_merchant_name
  FROM public.merchants
  WHERE id = p_merchant_id AND is_active = TRUE;

  IF v_merchant_name IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Merchant not found or inactive',
      NULL::uuid, NULL::text, NULL::integer, NULL::timestamptz;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_rider_id) THEN
    RETURN QUERY SELECT FALSE, 'Rider not found',
      NULL::uuid, NULL::text, NULL::integer, NULL::timestamptz;
    RETURN;
  END IF;

  INSERT INTO public.nfc_charge_sessions (rider_id, merchant_id, amount_cents, expires_at)
  VALUES (p_rider_id, p_merchant_id, p_amount_cents, v_expires_at)
  RETURNING id INTO v_session_id;

  RETURN QUERY SELECT TRUE, NULL::text, v_session_id, v_merchant_name,
    p_amount_cents, v_expires_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_nfc_charge_session(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_nfc_charge_session(uuid, uuid, integer)
  TO service_role;

-- ── 3. Session-consuming charge (merchant-side) ──────────────────────────────
-- Mirrors merchant_wallet_charge's money movement exactly (same ledger rows,
-- same balance maths, same TT$2,000 ceiling — the ceiling is enforced at
-- session creation), with three differences that are the whole point:
--   * the rider and the amount come from the session, never from the caller;
--   * the session row is locked FOR UPDATE, so concurrent submits serialise;
--   * a consumed session returns its recorded first result (already_consumed)
--     instead of debiting again.
CREATE OR REPLACE FUNCTION public.merchant_wallet_charge_authorised(
    p_session_id  uuid,
    p_merchant_id uuid
)
RETURNS TABLE(
    success            boolean,
    error_message      text,
    transaction_id     uuid,
    rider_id           uuid,
    rider_name         text,
    rider_balance_after integer,
    amount_cents       integer,
    already_consumed   boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_session          public.nfc_charge_sessions%ROWTYPE;
  v_balance          integer;
  v_advisory_lock_id bigint;
  v_txn_id           uuid := gen_random_uuid();
  v_rider_name       text;
  v_merchant_user_id uuid;
  v_merchant_name    text;
BEGIN
  SELECT * INTO v_session
  FROM public.nfc_charge_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Charge session not found',
      NULL::uuid, NULL::uuid, NULL::text, NULL::integer, NULL::integer, FALSE;
    RETURN;
  END IF;

  IF v_session.merchant_id <> p_merchant_id THEN
    RETURN QUERY SELECT FALSE, 'Charge session belongs to a different merchant',
      NULL::uuid, NULL::uuid, NULL::text, NULL::integer, NULL::integer, FALSE;
    RETURN;
  END IF;

  IF v_session.status = 'consumed' THEN
    -- Idempotent replay: report the first charge, move nothing.
    SELECT full_name INTO v_rider_name
    FROM public.profiles WHERE id = v_session.rider_id;
    RETURN QUERY SELECT TRUE, NULL::text, v_session.transaction_id,
      v_session.rider_id, COALESCE(v_rider_name, 'Rider'),
      v_session.rider_balance_after, v_session.amount_cents, TRUE;
    RETURN;
  END IF;

  IF v_session.status <> 'authorised' THEN
    RETURN QUERY SELECT FALSE, 'Charge session is ' || v_session.status,
      NULL::uuid, NULL::uuid, NULL::text, NULL::integer, NULL::integer, FALSE;
    RETURN;
  END IF;

  IF v_session.expires_at < now() THEN
    UPDATE public.nfc_charge_sessions
      SET status = 'expired'
      WHERE id = v_session.id;
    RETURN QUERY SELECT FALSE, 'Charge session has expired',
      NULL::uuid, NULL::uuid, NULL::text, NULL::integer, NULL::integer, FALSE;
    RETURN;
  END IF;

  v_advisory_lock_id := ('x' || substr(md5(v_session.rider_id::text), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_advisory_lock_id);

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
  FROM public.wallet_transactions
  WHERE user_id = v_session.rider_id;

  IF v_balance < v_session.amount_cents THEN
    RETURN QUERY SELECT FALSE,
      format('Insufficient balance: TTD $%s available', (v_balance / 100.0)::numeric(10,2)),
      NULL::uuid, NULL::uuid, NULL::text, NULL::integer, NULL::integer, FALSE;
    RETURN;
  END IF;

  SELECT full_name INTO v_rider_name
  FROM public.profiles
  WHERE id = v_session.rider_id;

  SELECT created_by, name INTO v_merchant_user_id, v_merchant_name
  FROM public.merchants
  WHERE id = v_session.merchant_id AND is_active = TRUE;

  IF v_merchant_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Merchant not found or inactive',
      NULL::uuid, NULL::uuid, NULL::text, NULL::integer, NULL::integer, FALSE;
    RETURN;
  END IF;

  INSERT INTO public.wallet_transactions
    (id, user_id, amount, transaction_type, description, status)
  VALUES
    (v_txn_id, v_session.rider_id, -v_session.amount_cents, 'merchant_purchase',
     COALESCE(v_merchant_name, 'Merchant') || ' purchase', 'completed');

  INSERT INTO public.wallets (user_id, balance_cents)
  VALUES (v_session.rider_id, -v_session.amount_cents)
  ON CONFLICT (user_id) DO UPDATE
    SET balance_cents = GREATEST(0, wallets.balance_cents - v_session.amount_cents),
        updated_at = NOW();

  -- COMMISSION: full amount to the merchant owner, unchanged from
  -- merchant_wallet_charge — no locked rate exists for tap charges
  -- (see header). Do not "fix" this line without Taylor's ruling.
  INSERT INTO public.wallet_transactions
    (id, user_id, amount, transaction_type, description, status)
  VALUES
    (gen_random_uuid(), v_merchant_user_id, v_session.amount_cents, 'merchant_commission',
     COALESCE(v_merchant_name, 'Merchant') || ' payment received', 'completed');

  INSERT INTO public.payment_ledger
    (id, user_id, amount, currency, status, provider, metadata)
  VALUES
    (gen_random_uuid(), v_session.rider_id, (v_session.amount_cents / 100.0), 'TTD',
     'captured', 'wallet',
     jsonb_build_object(
       'merchant_id', v_session.merchant_id,
       'merchant_name', v_merchant_name,
       'transaction_type', 'merchant_purchase',
       'charge_session_id', v_session.id
     ));

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
  FROM public.wallet_transactions
  WHERE user_id = v_session.rider_id;

  UPDATE public.nfc_charge_sessions
    SET status = 'consumed',
        transaction_id = v_txn_id,
        rider_balance_after = v_balance,
        consumed_at = now()
    WHERE id = v_session.id;

  RETURN QUERY SELECT TRUE, NULL::text, v_txn_id, v_session.rider_id,
    COALESCE(v_rider_name, 'Rider'), v_balance, v_session.amount_cents, FALSE;

EXCEPTION
  WHEN OTHERS THEN
    RETURN QUERY SELECT FALSE, SQLERRM,
      NULL::uuid, NULL::uuid, NULL::text, NULL::integer, NULL::integer, FALSE;
END;
$function$;

REVOKE ALL ON FUNCTION public.merchant_wallet_charge_authorised(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merchant_wallet_charge_authorised(uuid, uuid)
  TO service_role;

-- ── 4. nfc_event_handler nonce replay guard (race-proofing) ─────────────────
-- The handler already checks nfc_event_logs for a seen nonce; this index is
-- what makes the check hold under concurrency: one consumed nonce per
-- profile, enforced by the database. Duplicate inserts surface as SQLSTATE
-- 23505, which the handler treats as a no-op success.
-- APPLIER NOTE: if index creation fails on legacy duplicate rows, dedupe
-- nfc_event_logs keeping the earliest row per (profile_id, nonce) and
-- re-run — those rows are analytics logs, safe to dedupe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nfc_event_logs_profile_nonce
  ON public.nfc_event_logs (profile_id, ((location_context ->> 'nonce')))
  WHERE (location_context ->> 'nonce') IS NOT NULL;
