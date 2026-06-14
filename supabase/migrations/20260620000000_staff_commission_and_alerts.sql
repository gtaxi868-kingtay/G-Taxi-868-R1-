-- Staff sub-commission + wallet type additions
-- 1. Expands credit_merchant_commission to also pay the staff member who generated the ride
-- 2. Adds 'staff_commission' and 'merchant_subscription' to wallet_transactions type constraint

-- ── Wallet transaction type constraint (add missing types) ────────────────────
ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_transaction_type_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_transaction_type_check
    CHECK (transaction_type IN (
        'topup', 'ride_payment', 'refund', 'bonus',
        'driver_payout', 'tip', 'commission_fee',
        'cancellation_fee', 'leakage_fine', 'debt_recovery',
        'payout', 'debt_repayment',
        'lease_deduction', 'lease_income',
        'capital_reserve',
        'merchant_commission',
        'merchant_subscription',
        'staff_commission',
        'travel_package_payment', 'travel_package_refund',
        'scout_referral_payout'
    ));

-- ── Updated credit_merchant_commission ───────────────────────────────────────
-- Now accepts optional staff_member_id + staff_amount_cents.
-- Staff earn 1% of ride fare (separate from the merchant's 3% — both deducted from platform margin).
-- Idempotent on ride_id via the vendor_commissions insert in complete_ride.
CREATE OR REPLACE FUNCTION credit_merchant_commission(
    p_merchant_id        UUID,
    p_ride_id            UUID,
    p_amount_cents       INTEGER,
    p_staff_member_id    UUID    DEFAULT NULL,
    p_staff_amount_cents INTEGER DEFAULT 0
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    -- Credit the merchant owner's wallet
    SELECT created_by INTO v_user_id FROM merchants WHERE id = p_merchant_id;
    IF v_user_id IS NULL THEN RETURN; END IF;

    INSERT INTO wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
    VALUES (v_user_id, p_ride_id, p_amount_cents, 'merchant_commission',
            'Vendor kiosk commission', 'completed');

    INSERT INTO wallets (user_id, balance_cents)
    VALUES (v_user_id, p_amount_cents)
    ON CONFLICT (user_id)
    DO UPDATE SET balance_cents = wallets.balance_cents + p_amount_cents;

    -- Credit staff member if present and amount is positive
    IF p_staff_member_id IS NOT NULL AND p_staff_amount_cents > 0 THEN
        INSERT INTO wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
        VALUES (p_staff_member_id, p_ride_id, p_staff_amount_cents, 'staff_commission',
                'Staff kiosk referral commission', 'completed');

        INSERT INTO wallets (user_id, balance_cents)
        VALUES (p_staff_member_id, p_staff_amount_cents)
        ON CONFLICT (user_id)
        DO UPDATE SET balance_cents = wallets.balance_cents + p_staff_amount_cents;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION credit_merchant_commission(UUID, UUID, INTEGER, UUID, INTEGER) TO service_role;
