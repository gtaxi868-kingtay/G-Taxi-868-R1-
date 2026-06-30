-- Migration: Unify Debt Threshold Final Patch
-- Description: Replaces process_wallet_credit_idempotent and fn_auto_reactivate_driver
-- to enforce the uniform -30000 cent (-$300 TTD) threshold, aligning with
-- the ride acceptance check (accept_ride/index.ts:94).
--
-- Also fixes broken references to drivers.is_active which does not exist.
-- Replaces with drivers.is_online which is the actual column that controls
-- whether a driver can receive ride requests.

-- =============================================================================
-- 1. Fix process_wallet_credit_idempotent: -2000 → -30000, remove broken is_active
-- =============================================================================
CREATE OR REPLACE FUNCTION public.process_wallet_credit_idempotent(
    p_user_id UUID,
    p_amount_cents INT,
    p_reference_id TEXT,
    p_provider TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_already_processed INT;
    v_new_balance INT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

    SELECT COUNT(*) INTO v_already_processed
    FROM public.wallet_transactions
    WHERE reference_id = p_reference_id
      AND transaction_type = 'topup'
      AND status = 'completed';

    IF v_already_processed > 0 THEN
        RETURN FALSE;
    END IF;

    INSERT INTO public.wallet_transactions
        (user_id, ride_id, amount, transaction_type, description, reference_id, status)
    VALUES
        (p_user_id, NULL, p_amount_cents, 'topup',
         'Wallet top-up via ' || p_provider, p_reference_id, 'completed');

    -- Calculate post-topup balance from the event-sourced ledger
    SELECT COALESCE(SUM(amount), 0) INTO v_new_balance
    FROM public.wallet_transactions
    WHERE user_id = p_user_id;

    -- Auto-reactivate driver if balance clears the -$300 TTD threshold
    -- Note: is_online is the column that controls ride request delivery.
    -- If the driver manually went offline they must toggle back on, but
    -- if they were auto-suspended by debt they are restored here.
    IF v_new_balance >= -30000 THEN
        UPDATE public.drivers
        SET is_online = true,
            updated_at = now()
        WHERE user_id = p_user_id
          AND is_online = false;
    END IF;

    RETURN TRUE;
END;
$$;

-- =============================================================================
-- 2. Fix fn_auto_reactivate_driver: align threshold, fix broken is_active ref
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_auto_reactivate_driver()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_balance INT;
BEGIN
    IF NEW.transaction_type = 'topup' AND NEW.amount > 0 THEN
        SELECT COALESCE(SUM(amount), 0) INTO v_balance
        FROM public.wallet_transactions
        WHERE user_id = NEW.user_id;

        IF v_balance >= -30000 THEN
            UPDATE public.drivers
            SET is_online = true,
                updated_at = now()
            WHERE user_id = NEW.user_id
              AND is_online = false;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
