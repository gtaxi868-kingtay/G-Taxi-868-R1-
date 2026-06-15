-- Driver loan program funded by the capital reserve war chest.
-- Drivers can receive loans repaid via per-ride installment deductions
-- (deducted before driver payout in complete_ride).

CREATE TABLE IF NOT EXISTS driver_loans (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id         UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    principal_cents   INTEGER NOT NULL CHECK (principal_cents > 0),
    balance_cents     INTEGER NOT NULL CHECK (balance_cents >= 0),
    installment_cents INTEGER NOT NULL DEFAULT 5000 CHECK (installment_cents > 0),
    interest_rate     NUMERIC(5,4) NOT NULL DEFAULT 0.00,
    status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'paid_off', 'defaulted', 'written_off')),
    capital_reserve_entry_id UUID REFERENCES capital_reserve_ledger(id),
    notes             TEXT,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_loans_driver ON driver_loans(driver_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_driver_loans_active ON driver_loans(status) WHERE status = 'active';

-- RLS: service role only (admin reads via edge functions / service client)
ALTER TABLE driver_loans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages driver loans"
    ON driver_loans FOR ALL
    USING (auth.role() = 'service_role');

-- Driver can read their own loans
CREATE POLICY "driver reads own loans"
    ON driver_loans FOR SELECT
    USING (
        driver_id = (SELECT id FROM drivers WHERE user_id = auth.uid())
    );

-- RPC: admin creates a driver loan, drawing from the capital reserve
CREATE OR REPLACE FUNCTION admin_create_driver_loan(
    p_driver_id       UUID,
    p_principal_cents INTEGER,
    p_installment_cents INTEGER DEFAULT 5000,
    p_notes           TEXT DEFAULT NULL
) RETURNS driver_loans
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_reserve_entry_id UUID;
    v_loan             driver_loans;
BEGIN
    -- Check no active loan already exists for this driver
    IF EXISTS (SELECT 1 FROM driver_loans WHERE driver_id = p_driver_id AND status = 'active') THEN
        RAISE EXCEPTION 'Driver already has an active loan';
    END IF;

    -- Record reserve deployment
    INSERT INTO capital_reserve_ledger (source, amount_cents, status, notes)
    VALUES ('driver_loan', p_principal_cents, 'deployed', 'Driver loan: ' || p_driver_id::text)
    RETURNING id INTO v_reserve_entry_id;

    -- Credit driver wallet
    INSERT INTO wallet_transactions (user_id, amount, transaction_type, description, status)
    SELECT user_id, p_principal_cents, 'bonus',
           format('Driver loan disbursement — %s installments of TTD $%s',
                  ceil(p_principal_cents::numeric / p_installment_cents),
                  (p_installment_cents / 100.0)::text), 'completed'
    FROM drivers WHERE id = p_driver_id;

    -- Create loan record
    INSERT INTO driver_loans (
        driver_id, principal_cents, balance_cents,
        installment_cents, capital_reserve_entry_id, notes
    )
    VALUES (
        p_driver_id, p_principal_cents, p_principal_cents,
        p_installment_cents, v_reserve_entry_id, p_notes
    )
    RETURNING * INTO v_loan;

    RETURN v_loan;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_create_driver_loan(UUID, INTEGER, INTEGER, TEXT) TO service_role;

-- RPC: called by complete_ride to deduct the installment before driver payout
CREATE OR REPLACE FUNCTION deduct_loan_installment(p_driver_id UUID, p_ride_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_loan     driver_loans;
    v_deduction INTEGER;
BEGIN
    SELECT * INTO v_loan
    FROM driver_loans
    WHERE driver_id = p_driver_id AND status = 'active'
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN RETURN 0; END IF;

    v_deduction := LEAST(v_loan.installment_cents, v_loan.balance_cents);

    UPDATE driver_loans
    SET balance_cents = balance_cents - v_deduction,
        status = CASE WHEN balance_cents - v_deduction = 0 THEN 'paid_off' ELSE 'active' END,
        updated_at = now()
    WHERE id = v_loan.id;

    -- Wallet debit from driver
    INSERT INTO wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
    SELECT user_id, p_ride_id, -v_deduction, 'debt_repayment',
           format('Loan repayment (balance: TTD $%s remaining)', ((v_loan.balance_cents - v_deduction) / 100.0)::text), 'completed'
    FROM drivers WHERE id = p_driver_id;

    RETURN v_deduction;
END;
$$;

GRANT EXECUTE ON FUNCTION deduct_loan_installment(UUID, UUID) TO service_role;
