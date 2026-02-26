-- Migration: 20260226000000_phase6_wallet_81_19_split.sql
-- Phase 6 Fix 6.7 — Update process_wallet_payment RPC to use 81/19 split.
--
-- Previous split: 80% driver / 20% platform
-- New split:      81% driver / 19% platform
--
-- This migration replaces the entire function so the description strings,
-- comments, and arithmetic are all consistent with the new business rules.

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
    -- Prevents concurrent calls for the same ride from both reading
    -- a positive balance and both succeeding (race condition fix from Phase 3).
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
    -- If already captured (e.g. retry or double-tap), treat as success.
    IF v_payment_status = 'captured' THEN
        RETURN TRUE;
    END IF;

    -- ── Step 3: Check rider wallet balance ────────────────────────────────────
    SELECT COALESCE(SUM(amount), 0)
        INTO v_balance
    FROM public.wallet_transactions
    WHERE user_id = v_rider_id;

    IF v_balance < p_amount THEN
        -- Insufficient funds — do not proceed.
        RETURN FALSE;
    END IF;

    -- ── Step 4: Calculate 81/19 platform split ────────────────────────────────
    -- Fix 6.7: Changed from 80/20 to 81/19.
    -- Platform keeps 19%, driver receives 81%.
    v_platform_fee := ROUND(p_amount * 0.19);
    v_driver_net   := p_amount - v_platform_fee;

    -- ── Step 5: Write atomic wallet transactions ──────────────────────────────
    -- A. Debit rider (full fare)
    INSERT INTO public.wallet_transactions
        (user_id, ride_id, amount, transaction_type, description, status)
    VALUES
        (v_rider_id, p_ride_id, -p_amount, 'ride_payment', 'Ride payment (wallet)', 'completed');

    -- B. Credit driver (81%)
    INSERT INTO public.wallet_transactions
        (user_id, ride_id, amount, transaction_type, description, status)
    VALUES
        (v_driver_id, p_ride_id, v_driver_net, 'driver_payout', 'Ride earnings (81%)', 'completed');

    -- C. Credit platform (19%)
    INSERT INTO public.wallet_transactions
        (user_id, ride_id, amount, transaction_type, description, status)
    VALUES
        (v_platform_id, p_ride_id, v_platform_fee, 'platform_commission', 'Platform commission (19%)', 'completed');

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
