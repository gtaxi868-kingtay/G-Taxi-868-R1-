-- ADMIN TOOLS (Safe Top Up)
-- Bypasses RLS via Security Definer

BEGIN;

CREATE OR REPLACE FUNCTION admin_top_up(p_user_id UUID, p_amount INTEGER) RETURNS BOOLEAN AS $$
BEGIN
    INSERT INTO public.wallet_transactions (
        user_id, ride_id, amount, transaction_type, description, status
    ) VALUES (
        p_user_id, NULL, p_amount, 'topup', 'Admin Manual Top Up', 'completed'
    );
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- SECURE IT: Only Service Role can call this
REVOKE EXECUTE ON FUNCTION admin_top_up(UUID, INTEGER) FROM public;
REVOKE EXECUTE ON FUNCTION admin_top_up(UUID, INTEGER) FROM authenticated;
REVOKE EXECUTE ON FUNCTION admin_top_up(UUID, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION admin_top_up(UUID, INTEGER) TO service_role;

COMMIT;
