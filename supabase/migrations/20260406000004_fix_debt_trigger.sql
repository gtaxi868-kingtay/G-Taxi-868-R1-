-- 🛠️ FIX: check_global_debt_blocking
-- Replaces the broken trigger function that referenced a non-existent column

CREATE OR REPLACE FUNCTION check_global_debt_blocking()
RETURNS TRIGGER AS $$
DECLARE
    v_balance INTEGER;
BEGIN
    -- Calculate rider balance from wallet_transactions
    SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.wallet_transactions
    WHERE user_id = NEW.rider_id;

    -- If a user has a balance < -$600.00 TTD ($60,000 cents), block them.
    IF v_balance < -60000 THEN
        RAISE EXCEPTION 'GLOBAL_DEBT_BLOCK: Account suspended due to outstanding balance ($%). Settle to resume.', (v_balance::float / 100.0);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 🛠️ ATTACH TRIGGER TO RIDES
DROP TRIGGER IF EXISTS trigger_check_global_debt ON public.rides;
CREATE TRIGGER trigger_check_global_debt
    BEFORE INSERT ON public.rides
    FOR EACH ROW
    EXECUTE FUNCTION check_global_debt_blocking();

-- 🛠️ ATTACH TRIGGER TO ORDERS
DROP TRIGGER IF EXISTS trigger_check_global_debt ON public.orders;
CREATE TRIGGER trigger_check_global_debt
    BEFORE INSERT ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION check_global_debt_blocking();
