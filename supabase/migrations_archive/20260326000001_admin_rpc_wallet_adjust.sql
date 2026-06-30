-- Phase 4: RPC Layer for Admin Control

CREATE OR REPLACE FUNCTION public.admin_wallet_adjust(
    p_user_id UUID,
    p_amount_cents INTEGER, -- Positive or negative adjustment
    p_reason TEXT,
    p_admin_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Verify admin role
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can adjust wallets';
    END IF;

    -- Note: Wallet balances in G-TAXI are computed dynamically from `wallet_transactions`.
    -- We do not update a static `wallets` table balance directly.
    -- We simply insert an atomic ledger transaction representing the admin adjustment.
    
    INSERT INTO public.wallet_transactions (
        user_id,
        amount,
        transaction_type,
        status,
        description
    ) VALUES (
        p_user_id,
        p_amount_cents,
        'admin_adjustment', -- The specific type required by prompt
        'completed',
        'Admin Adjustment: ' || p_reason
    );

    RETURN TRUE;
END;
$$;
