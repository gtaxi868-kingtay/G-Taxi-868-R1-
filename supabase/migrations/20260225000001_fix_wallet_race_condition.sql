-- Migration: 20260225000001_fix_wallet_race_condition.sql
-- Phase 3 Fix 3.3 — Replace process_wallet_payment with an atomic version
--
-- Problem: The previous implementation reads wallet balance via SUM(wallet_transactions)
-- and then inserts a debit transaction as two separate steps. Under concurrent requests
-- (double-taps, retry storms) both reads can see the same positive balance and both
-- proceed to debit, resulting in a negative balance / free rides.
--
-- Fix: Lock the RIDE row for the duration of the transaction. Since a ride_id is
-- unique and all payment calls pass it, this guarantees only one payment succeeds
-- per ride. Idempotency is handled by checking payment_status = 'captured' first.
-- Also writes a canonical record to payment_ledger.

BEGIN;
CREATE OR REPLACE FUNCTION public.process_wallet_payment(
    p_ride_id   UUID,
    p_amount    INTEGER   -- amount in cents (TTD)
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_rider_id       UUID;
    v_driver_id      UUID;
    v_platform_id    UUID := '00000000-0000-0000-0000-000000000000';
    v_payment_status TEXT;
    v_balance        INTEGER;
    v_driver_net     INTEGER;
    v_platform_fee   INTEGER;
BEGIN
    -- ── Step 1: Lock the ride row for the entire transaction ──────────────────
    -- This prevents concurrent calls for the same ride from both reading
    -- a positive balance and both succeeding.
    SELECT rider_id, driver_id, payment_status
        INTO v_rider_id, v_driver_id, v_payment_status
    FROM public.rides
    WHERE id = p_ride_id
    FOR UPDATE;

    IF v_rider_id IS NULL THEN
        RAISE EXCEPTION 'Ride % not found', p_ride_id;
    END IF;

    IF v_driver_id IS NULL THEN
        RAISE EXCEPTION 'Ride % has no assigned driver', p_ride_id;
    END IF;

    -- ── Step 2: Idempotency guard ─────────────────────────────────────────────
    -- If already captured (e.g. retry), treat as success without double-charging.
    IF v_payment_status = 'captured' THEN
        RETURN TRUE;
    END IF;

    -- ── Step 3: Check rider wallet balance (computed from transaction ledger) ─
    SELECT COALESCE(SUM(amount), 0)
        INTO v_balance
    FROM public.wallet_transactions
    WHERE user_id = v_rider_id;

    IF v_balance < p_amount THEN
        -- Insufficient funds — do not proceed.
        RETURN FALSE;
    END IF;

    -- ── Step 4: Calculate 80/20 platform split ────────────────────────────────
    v_platform_fee := ROUND(p_amount * 0.20);
    v_driver_net   := p_amount - v_platform_fee;

    -- ── Step 5: Write atomic wallet transactions ──────────────────────────────
    -- A. Debit rider (full fare)
    INSERT INTO public.wallet_transactions
        (user_id, ride_id, amount, transaction_type, description, status)
    VALUES
        (v_rider_id, p_ride_id, -p_amount, 'ride_payment', 'Ride payment', 'completed');

    -- B. Credit driver (80%)
    INSERT INTO public.wallet_transactions
        (user_id, ride_id, amount, transaction_type, description, status)
    VALUES
        (v_driver_id, p_ride_id, v_driver_net, 'driver_payout', 'Ride earnings (80%)', 'completed');

    -- C. Credit platform (20%)
    INSERT INTO public.wallet_transactions
        (user_id, ride_id, amount, transaction_type, description, status)
    VALUES
        (v_platform_id, p_ride_id, v_platform_fee, 'ride_payment', 'Platform commission (20%)', 'completed');

    -- ── Step 6: Write canonical payment_ledger record ─────────────────────────
    INSERT INTO public.payment_ledger
        (ride_id, user_id, amount, currency, status, provider)
    VALUES
        (p_ride_id, v_rider_id, (p_amount / 100.0), 'TTD', 'captured', 'wallet');

    -- ── Step 7: Mark ride payment as captured ─────────────────────────────────
    UPDATE public.rides
    SET payment_status = 'captured',
        updated_at     = NOW()
    WHERE id = p_ride_id;

    RETURN TRUE;
END;
$$;
COMMIT;
