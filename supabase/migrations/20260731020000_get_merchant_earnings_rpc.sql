-- get_merchant_earnings: total settled merchant cut across the merchant's nodes.
-- The merchant web app called this RPC for months without it ever existing —
-- every call 404'd and the page survived on a fallback query by accident.
-- This is the canonical version: SECURITY DEFINER, identity verified from the
-- caller's JWT (profiles.merchant_id), never trusts the merchant_id argument
-- alone.

CREATE OR REPLACE FUNCTION public.get_merchant_earnings(p_merchant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_merchant uuid;
    v_total_cents bigint;
    v_count bigint;
BEGIN
    -- Resolve the caller's merchant from the JWT, not from the argument.
    SELECT merchant_id INTO v_caller_merchant
    FROM profiles
    WHERE id = auth.uid();

    IF v_caller_merchant IS NULL OR v_caller_merchant <> p_merchant_id THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    -- Sum settled merchant cuts for every kiosk node owned by this merchant.
    SELECT COALESCE(SUM(rs.merchant_cut), 0)::bigint,
           COUNT(*)::bigint
    INTO v_total_cents, v_count
    FROM revenue_splits rs
    JOIN kiosk_nodes kn ON kn.id = rs.node_id
    WHERE kn.merchant_id = p_merchant_id
      AND rs.status = 'settled';

    RETURN jsonb_build_object(
        'total_cents', v_total_cents,
        'settled_count', v_count
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_merchant_earnings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_merchant_earnings(uuid) TO authenticated;
