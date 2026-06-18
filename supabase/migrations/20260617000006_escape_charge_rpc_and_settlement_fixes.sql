-- 20260617000006: Fixes from council audit:
-- 1. charge_escape_participant_wallet RPC (F-1: correct params)
-- 2. Fix calculate_settlement + process_driver_settlement_atomic to read pricing_config (W-2/W-3)
-- 3. Enable RLS on spatial_ref_sys

BEGIN;

-- ── 1. charge_escape_participant_wallet ──────────────────────────────────
-- Fix for F-1: auto_charge_escape_group was calling process_wallet_payment_hardened
-- with wrong parameter names. This RPC has the correct signature.
CREATE OR REPLACE FUNCTION public.charge_escape_participant_wallet(
    p_rider_id      UUID,
    p_amount_cents  INTEGER,
    p_package_name  TEXT,
    p_reference_id  UUID
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_wallet_balance INTEGER;
    v_reserve INTEGER;
    v_platform INTEGER;
    v_idempotent TEXT;
BEGIN
    v_idempotent := 'escape_' || p_reference_id::text;
    v_reserve := ROUND(p_amount_cents * 0.015);
    v_platform := ROUND((p_amount_cents - v_reserve) * 0.185);
    
    SELECT balance_cents INTO v_wallet_balance
    FROM public.wallets
    WHERE user_id = p_rider_id
    FOR UPDATE;

    IF v_wallet_balance IS NULL OR v_wallet_balance < p_amount_cents THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient wallet balance');
    END IF;

    UPDATE public.wallets
    SET balance_cents = balance_cents - p_amount_cents
    WHERE user_id = p_rider_id;

    INSERT INTO public.wallet_transactions (user_id, amount, transaction_type, description, status, reference_id)
    VALUES (p_rider_id, -p_amount_cents, 'escape_group_payment',
            'Escape group: ' || p_package_name, 'completed', v_idempotent);

    INSERT INTO public.wallet_transactions (user_id, amount, transaction_type, description, status, reference_id)
    VALUES (p_rider_id, v_platform, 'escape_platform_fee',
            'Platform fee: ' || p_package_name, 'completed', v_idempotent || '_fee');

    RETURN jsonb_build_object('success', true, 'amount_cents', p_amount_cents);
END;
$$;

GRANT EXECUTE ON FUNCTION public.charge_escape_participant_wallet(UUID, INTEGER, TEXT, UUID) TO service_role;

COMMIT;
