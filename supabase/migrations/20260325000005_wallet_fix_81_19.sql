-- Migration: 20260325_wallet_fix_81_19.sql
-- G-TAXI HARDENING: Fix 10 - Wallet Overdraft & 81/19 Split
-- Description: Updates the process_wallet_payment RPC to enforce the 19% platform cut (was 20%).

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
    -- 1. Lock the ride row for the entire transaction (Atomic Guard)
    SELECT rider_id, driver_id, payment_status
        INTO v_rider_id, v_driver_id, v_payment_status
    FROM public.rides
    WHERE id = p_ride_id
    FOR UPDATE;

    IF v_rider_id IS NULL THEN
        RAISE EXCEPTION 'Ride % not found', p_ride_id;
    END IF;

    -- 2. Idempotency guard (Prevent double charging)
    IF v_payment_status = 'captured' THEN
        RETURN TRUE;
    END IF;

    -- 3. Check rider wallet balance (Overdraft Protection)
    SELECT COALESCE(SUM(amount), 0)
        INTO v_balance
    FROM public.wallet_transactions
    WHERE user_id = v_rider_id;

    IF v_balance < p_amount THEN
        -- Insufficient funds
        RETURN FALSE;
    END IF;

    -- 4. Calculate 81/19 platform split (Fix 10 Hardened)
    v_platform_fee := ROUND(p_amount * 0.19);
    v_driver_net   := p_amount - v_platform_fee;

    -- 5. Write atomic wallet transactions
    -- A. Debit rider (full fare)
    INSERT INTO public.wallet_transactions
        (user_id, ride_id, amount, transaction_type, description, status)
    VALUES
        (v_rider_id, p_ride_id, -p_amount, 'ride_payment', 'Ride payment', 'completed');

    -- B. Credit driver (81%)
    INSERT INTO public.wallet_transactions
        (user_id, ride_id, amount, transaction_type, description, status)
    VALUES
        (v_driver_id, p_ride_id, v_driver_net, 'driver_payout', 'Ride earnings (81%)', 'completed');

    -- C. Credit platform (19%)
    INSERT INTO public.wallet_transactions
        (user_id, ride_id, amount, transaction_type, description, status)
    VALUES
        (v_platform_id, p_ride_id, v_platform_fee, 'ride_payment', 'Platform commission (19%)', 'completed');

    -- 6. Write canonical payment_ledger record
    INSERT INTO public.payment_ledger
        (ride_id, user_id, amount, currency, status, provider)
    VALUES
        (p_ride_id, v_rider_id, (p_amount / 100.0), 'TTD', 'captured', 'wallet');

    -- 7. Mark ride payment as captured
    UPDATE public.rides
    SET payment_status = 'captured',
        updated_at     = NOW()
    WHERE id = p_ride_id;

    RETURN TRUE;
END;
$$;

COMMIT;
