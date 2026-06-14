-- handle_brokerage_commission: called by dealer_brokerage edge function
-- when financing is approved (action = 'financing_approved').
-- Without this, the function throws a DB error and the action crashes.

CREATE OR REPLACE FUNCTION handle_brokerage_commission(
    p_sale_id      UUID,
    p_dealer_id    UUID,
    p_amount_cents INTEGER
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_dealer_user_id UUID;
BEGIN
    -- Resolve dealer's user_id for wallet credit
    SELECT dp.contact_id INTO v_dealer_user_id
    FROM dealer_partners dp
    WHERE dp.id = p_dealer_id;

    -- Record commission in platform revenue log
    INSERT INTO platform_revenue_logs (
        source, reference_id, amount_cents, description, created_at
    ) VALUES (
        'brokerage_commission',
        p_sale_id,
        p_amount_cents,
        format('Dealer brokerage commission on sale %s', p_sale_id),
        now()
    );

    -- Credit dealer's wallet if user account exists
    IF v_dealer_user_id IS NOT NULL THEN
        INSERT INTO wallet_transactions (
            user_id, amount, transaction_type, description, status
        ) VALUES (
            v_dealer_user_id,
            p_amount_cents,
            'brokerage_commission',
            format('Brokerage commission — vehicle sale %s', left(p_sale_id::text, 8)),
            'completed'
        );
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION handle_brokerage_commission(UUID, UUID, INTEGER) TO service_role;
