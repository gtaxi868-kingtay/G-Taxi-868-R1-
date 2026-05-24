-- =============================================================================
-- MIGRATION: 20260522000001_capital_reserve_ledger.sql
-- WAR CHEST: 1.5% Capital Reserve on every ride settlement
-- =============================================================================
-- This migration enforces the financial mandate:
--   1.5% of gross fare is diverted to the capital_reserve_ledger BEFORE
--   any payout computation. The reserve is strictly separated from
--   operational revenue and can only be released by explicit admin action.
--
-- Settlement math (applied uniformly across ALL payment paths):
--   reserve      = round(gross * 0.015)
--   net          = gross - reserve
--   platform_fee = round(net * 0.185)
--   driver_payout = net - platform_fee
--   Invariant: reserve + platform_fee + driver_payout = gross
--
-- Uses PRODUCTION column names throughout: wallet_transactions.user_id,
-- wallet_transactions.transaction_type, wallet_transactions.amount
-- (never wallet_id, type, or amount_cents for wallet_transactions).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

-- =============================================================================
-- 1. CAPITAL RESERVE LEDGER (The War Chest)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.capital_reserve_ledger (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id         UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
    amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
    currency        TEXT NOT NULL DEFAULT 'TTD',
    status          TEXT NOT NULL DEFAULT 'locked'
                    CHECK (status IN ('locked', 'released', 'deployed')),
    wallet_transaction_id UUID REFERENCES public.wallet_transactions(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_capital_reserve_ride ON public.capital_reserve_ledger(ride_id);
CREATE INDEX IF NOT EXISTS idx_capital_reserve_status ON public.capital_reserve_ledger(status);
CREATE INDEX IF NOT EXISTS idx_capital_reserve_created ON public.capital_reserve_ledger(created_at);

COMMENT ON TABLE public.capital_reserve_ledger IS
    '1.5% Capital Reserve (War Chest). Locked on every ride completion. '
    'Strictly separated from platform_revenue_logs. '
    'Status transitions: locked → released (admin withdrawal) | deployed (strategic investment)';

-- RLS: No user access — service_role only
ALTER TABLE public.capital_reserve_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reserve ledger is service_role only"
    ON public.capital_reserve_ledger
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- =============================================================================
-- 2. ADD RESERVE COLUMNS TO EXISTING TABLES
-- =============================================================================

-- Track reserve on each ride
ALTER TABLE public.rides
    ADD COLUMN IF NOT EXISTS reserve_cents INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS platform_fee_cents INTEGER NOT NULL DEFAULT 0;

-- Track reserve in revenue logs (for reconciliation)
ALTER TABLE public.platform_revenue_logs
    ADD COLUMN IF NOT EXISTS reserve_cents INTEGER NOT NULL DEFAULT 0;

-- =============================================================================
-- 3. ADD CAPITAL_RESERVE TO WALLET TRANSACTION TYPES
-- =============================================================================

ALTER TABLE public.wallet_transactions
    DROP CONSTRAINT IF EXISTS wallet_transactions_transaction_type_check;

ALTER TABLE public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_transaction_type_check
    CHECK (transaction_type IN (
        'topup', 'ride_payment', 'refund', 'bonus',
        'driver_payout', 'tip', 'commission_fee',
        'cancellation_fee', 'leakage_fine', 'debt_recovery',
        'payout', 'debt_repayment',
        'lease_deduction', 'lease_income',
        'capital_reserve'
    ));

-- =============================================================================
-- 4. THE SETTLEMENT MATH — SINGLE SOURCE OF TRUTH
-- =============================================================================

CREATE OR REPLACE FUNCTION public.calculate_settlement(
    p_gross_cents INTEGER
) RETURNS TABLE (
    reserve_cents       INTEGER,
    platform_fee_cents  INTEGER,
    driver_payout_cents INTEGER
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_reserve   INTEGER;
    v_net       INTEGER;
    v_platform  INTEGER;
BEGIN
    v_reserve  := ROUND(p_gross_cents * 0.015);
    v_net      := p_gross_cents - v_reserve;
    v_platform := ROUND(v_net * 0.185);

    RETURN QUERY SELECT
        v_reserve,
        v_platform,
        (v_net - v_platform)::INTEGER;
END;
$$;

COMMENT ON FUNCTION public.calculate_settlement IS
    'Uniform settlement math used by ALL payment paths:
     reserve = round(gross * 0.015)
     net = gross - reserve
     platform_fee = round(net * 0.185)
     driver_payout = net - platform_fee
     Invariant: reserve + platform_fee + driver_payout = gross';

GRANT EXECUTE ON FUNCTION public.calculate_settlement TO service_role;

-- =============================================================================
-- 5. process_wallet_payment_hardened — New settlement math + reserve
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_wallet_payment_hardened(
    p_ride_id   UUID,
    p_amount    INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_rider_id           UUID;
    v_driver_id          UUID;
    v_platform_id        UUID := '00000000-0000-0000-0000-000000000000';
    v_payment_status     TEXT;
    v_ride_status        TEXT;
    v_balance            INTEGER;
    v_advisory_lock_id   BIGINT;
    v_txn_id             UUID := gen_random_uuid();

    -- Settlement breakdown
    v_reserve            INTEGER;
    v_platform_fee       INTEGER;
    v_driver_net         INTEGER;
BEGIN
    -- ── Step 0: Input validation ───────────────────────────────────────────────
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid amount: must be positive');
    END IF;

    IF p_ride_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ride ID is required');
    END IF;

    -- ── Step 1: Acquire advisory lock on ride ──────────────────────────────
    v_advisory_lock_id := ('x' || substr(md5(p_ride_id::text), 1, 16))::bit(64)::bigint;

    IF NOT pg_try_advisory_xact_lock(v_advisory_lock_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ride is being processed by another request');
    END IF;

    -- ── Step 2: Lock the ride row and validate state ──────────────────────────
    SELECT r.rider_id, r.driver_id, r.payment_status, r.status
    INTO v_rider_id, v_driver_id, v_payment_status, v_ride_status
    FROM public.rides r
    WHERE r.id = p_ride_id
    FOR UPDATE;

    IF v_rider_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ride not found');
    END IF;

    IF v_driver_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ride has no assigned driver');
    END IF;

    IF v_ride_status NOT IN ('assigned', 'arrived', 'in_progress', 'completed') THEN
        RETURN jsonb_build_object('success', false, 'error',
            format('Cannot process payment for ride in %s status', v_ride_status));
    END IF;

    -- ── Step 3: Idempotency check ─────────────────────────────────────────────
    IF v_payment_status = 'captured' THEN
        RETURN jsonb_build_object('success', true, 'message', 'Payment already processed',
            'transaction_id', v_txn_id);
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.wallet_transactions
        WHERE ride_id = p_ride_id AND transaction_type = 'ride_payment' AND amount < 0
    ) THEN
        UPDATE public.rides SET payment_status = 'captured', updated_at = NOW()
        WHERE id = p_ride_id;
        RETURN jsonb_build_object('success', true, 'message', 'Payment already processed (state repaired)',
            'transaction_id', v_txn_id);
    END IF;

    -- ── Step 4: Lock rider wallet and check balance ───────────────────────────
    v_advisory_lock_id := ('x' || substr(md5(v_rider_id::text), 1, 16))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(v_advisory_lock_id);

    SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.wallet_transactions
    WHERE user_id = v_rider_id;

    IF v_balance < p_amount THEN
        RETURN jsonb_build_object('success', false, 'error',
            format('Insufficient balance: %s cents available, %s cents required', v_balance, p_amount));
    END IF;

    -- ── Step 5: Calculate settlement ─────────────────────────────────────────
    SELECT cs.reserve_cents, cs.platform_fee_cents, cs.driver_payout_cents
    INTO v_reserve, v_platform_fee, v_driver_net
    FROM public.calculate_settlement(p_amount) cs;

    -- ── Step 6: Execute all writes atomically ──────────────────────────────────

    -- 6A. Debit rider (total fare)
    INSERT INTO public.wallet_transactions
        (id, user_id, ride_id, amount, transaction_type, description, status)
    VALUES
        (gen_random_uuid(), v_rider_id, p_ride_id, -p_amount, 'ride_payment',
         'Ride payment (wallet)', 'completed');

    -- 6B. Credit driver (driver payout from settlement)
    INSERT INTO public.wallet_transactions
        (id, user_id, ride_id, amount, transaction_type, description, status)
    VALUES
        (gen_random_uuid(), v_driver_id, p_ride_id, v_driver_net, 'driver_payout',
         'Ride payout', 'completed');

    -- 6C. Credit platform — operational fee
    INSERT INTO public.wallet_transactions
        (id, user_id, ride_id, amount, transaction_type, description, status)
    VALUES
        (gen_random_uuid(), v_platform_id, p_ride_id, v_platform_fee, 'ride_payment',
         'Platform commission', 'completed');

    -- 6D. Credit platform — capital reserve (1.5% of gross)
    INSERT INTO public.wallet_transactions
        (id, user_id, ride_id, amount, transaction_type, description, status)
    VALUES
        (gen_random_uuid(), v_platform_id, p_ride_id, v_reserve, 'capital_reserve',
         '1.5% Capital Reserve (War Chest)', 'completed')
    RETURNING id INTO v_txn_id;

    -- 6E. Write to capital_reserve_ledger (THE WAR CHEST — immutable)
    INSERT INTO public.capital_reserve_ledger
        (ride_id, amount_cents, status, wallet_transaction_id, currency)
    VALUES
        (p_ride_id, v_reserve, 'locked', v_txn_id, 'TTD');

    -- 6F. Write to payment_ledger
    INSERT INTO public.payment_ledger
        (id, ride_id, user_id, amount, currency, status, provider)
    VALUES
        (gen_random_uuid(), p_ride_id, v_rider_id, (p_amount / 100.0), 'TTD',
         'captured', 'wallet');

    -- 6G. Update ride status — store settlement breakdown
    UPDATE public.rides
    SET
        payment_status = 'captured',
        updated_at = NOW(),
        total_fare_cents = COALESCE(total_fare_cents, p_amount),
        driver_payout_cents = COALESCE(driver_payout_cents, 0) + v_driver_net,
        platform_fee_cents = COALESCE(platform_fee_cents, 0) + v_platform_fee,
        reserve_cents = COALESCE(reserve_cents, 0) + v_reserve
    WHERE id = p_ride_id;

    -- 6H. Log platform revenue
    PERFORM public.log_platform_revenue(
        p_ride_id               := p_ride_id,
        p_order_id              := NULL,
        p_merchant_id           := NULL,
        p_gross_cents           := p_amount,
        p_payout_cents          := v_driver_net,
        p_merchant_earnings_cents := 0,
        p_reserve_cents         := v_reserve
    );

    -- ── Step 7: Return success with settlement details ─────────────────────────
    RETURN jsonb_build_object(
        'success', true,
        'transaction_id', v_txn_id,
        'reserve_cents', v_reserve,
        'platform_fee_cents', v_platform_fee,
        'driver_payout_cents', v_driver_net,
        'total_cents', p_amount
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.process_wallet_payment_hardened IS
    'Hardened wallet payment with 1.5% Capital Reserve deduction.
     Settlement: reserve(1.5%) + platform_fee(18.5% of net) + driver(remainder).
     Capital reserve is recorded in capital_reserve_ledger (status=locked).
     Uses production column names: user_id, transaction_type, amount.';

-- Recreate the backward-compatible wrapper (no signature change)
CREATE OR REPLACE FUNCTION public.process_wallet_payment(
    p_ride_id   UUID,
    p_amount    INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result JSONB;
BEGIN
    v_result := public.process_wallet_payment_hardened(p_ride_id, p_amount);

    IF (v_result ->> 'success')::BOOLEAN THEN
        RETURN TRUE;
    ELSE
        RAISE WARNING 'Wallet payment failed for ride %: %', p_ride_id, v_result ->> 'error';
        RETURN FALSE;
    END IF;
END;
$$;

-- =============================================================================
-- 6. UPDATE log_platform_revenue — Include reserve_cents
-- =============================================================================

CREATE OR REPLACE FUNCTION public.log_platform_revenue(
    p_ride_id               UUID,
    p_order_id              UUID,
    p_merchant_id           UUID,
    p_gross_cents           INTEGER,
    p_payout_cents          INTEGER,
    p_merchant_earnings_cents INTEGER DEFAULT 0,
    p_reserve_cents         INTEGER DEFAULT 0
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_platform_fee INTEGER;
BEGIN
    v_platform_fee := p_gross_cents - p_payout_cents - p_merchant_earnings_cents - p_reserve_cents;

    INSERT INTO public.platform_revenue_logs (
        ride_id, order_id, merchant_id,
        gross_amount_cents, platform_fee_cents,
        driver_payout_cents, merchant_split_cents,
        reserve_cents
    ) VALUES (
        p_ride_id, p_order_id, p_merchant_id,
        p_gross_cents, v_platform_fee,
        p_payout_cents, p_merchant_earnings_cents,
        p_reserve_cents
    );
END;
$$;

COMMENT ON FUNCTION public.log_platform_revenue IS
    'Logs platform revenue with reserve_cents separation.
     platform_fee = gross - payout - merchant_earnings - reserve';

GRANT EXECUTE ON FUNCTION public.log_platform_revenue TO service_role;

-- =============================================================================
-- 7. AUTO-INSERT TRIGGER — Failsafe for any completed ride
-- =============================================================================
-- This trigger ensures that even if an edge function fails to insert the
-- capital_reserve_ledger entry, it gets auto-inserted when the ride status
-- changes to 'completed' with a non-zero reserve_cents value.

CREATE OR REPLACE FUNCTION public.auto_insert_capital_reserve()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
        IF NEW.reserve_cents > 0 THEN
            INSERT INTO public.capital_reserve_ledger
                (ride_id, amount_cents, status, notes)
            SELECT
                NEW.id, NEW.reserve_cents, 'locked',
                'Auto-inserted by trigger on ride completion'
            WHERE NOT EXISTS (
                SELECT 1 FROM public.capital_reserve_ledger
                WHERE ride_id = NEW.id
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_capital_reserve
    AFTER UPDATE OF status ON public.rides
    FOR EACH ROW
    WHEN (NEW.status = 'completed')
    EXECUTE FUNCTION public.auto_insert_capital_reserve();

COMMENT ON TRIGGER trg_auto_capital_reserve ON public.rides IS
    'Failsafe: auto-inserts capital_reserve_ledger entry if edge function misses it.';

COMMIT;
