-- Phase S-1: Emergency Crash Prevention
-- Deploy payment_ledger table and verify completion trigger functions

BEGIN;

-- 1. Create payment_ledger table (idempotent)
CREATE TABLE IF NOT EXISTS payment_ledger (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id          UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES profiles(id),
    amount           NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    currency         TEXT NOT NULL DEFAULT 'TTD'
                       CHECK (currency IN ('TTD', 'USD')),
    status           TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','authorized','captured','failed','refunded')),
    provider         TEXT NOT NULL DEFAULT 'wallet'
                       CHECK (provider IN ('wallet','stripe','cash')),
    provider_ref     TEXT,
    stripe_event_id  TEXT UNIQUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. RLS on payment_ledger
ALTER TABLE payment_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own ledger entries" ON payment_ledger;
CREATE POLICY "Users view own ledger entries" ON payment_ledger
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "No direct inserts by users" ON payment_ledger;
CREATE POLICY "No direct inserts by users" ON payment_ledger
    FOR INSERT
    WITH CHECK (false);

DROP POLICY IF EXISTS "Service role manages ledger" ON payment_ledger;
CREATE POLICY "Service role manages ledger" ON payment_ledger
    FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_payment_ledger_ride ON payment_ledger(ride_id);
CREATE INDEX IF NOT EXISTS idx_payment_ledger_user ON payment_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_ledger_status ON payment_ledger(status);

-- 4. Ensure trigger functions exist from Phase 3 migration
-- auto_insert_ledger_on_completion: creates ledger row when ride is completed
CREATE OR REPLACE FUNCTION auto_insert_ledger_on_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_provider TEXT;
BEGIN
    IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.ledger_recorded IS DISTINCT FROM TRUE THEN
        v_provider := CASE NEW.payment_method
            WHEN 'wallet' THEN 'wallet'
            WHEN 'card'   THEN 'stripe'
            WHEN 'cash'   THEN 'cash'
            WHEN 'mixed'  THEN 'wallet'
            ELSE 'wallet'
        END;
        INSERT INTO public.payment_ledger
            (ride_id, user_id, amount, currency, status, provider, created_at)
        VALUES
            (NEW.id, NEW.rider_id, (NEW.total_fare_cents / 100.0), 'TTD', 'captured', v_provider, NOW());
        NEW.ledger_recorded := TRUE;
    END IF;
    RETURN NEW;
END;
$$;

-- check_payment_completion_safety: prevents completion without valid payment
CREATE OR REPLACE FUNCTION check_payment_completion_safety()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
        IF NEW.total_fare_cents IS NULL OR NEW.total_fare_cents = 0 THEN
            RETURN NEW;
        END IF;
        IF NEW.payment_method = 'cash' THEN
            IF NEW.cash_confirmed IS NOT TRUE THEN
                RAISE EXCEPTION 'Ride cannot complete without valid payment confirmation (Cash not confirmed)';
            END IF;
        ELSIF NEW.payment_method = 'wallet' THEN
            IF NEW.payment_status NOT IN ('captured', 'confirmed') THEN
                RAISE EXCEPTION 'Ride cannot complete without valid payment confirmation (Wallet not captured)';
            END IF;
        ELSIF NEW.payment_method = 'card' THEN
            IF NEW.payment_status != 'captured' THEN
                RAISE EXCEPTION 'Ride cannot complete without valid payment confirmation (Card not captured)';
            END IF;
        ELSIF NEW.payment_method = 'mixed' THEN
            IF NEW.payment_status NOT IN ('captured', 'confirmed') THEN
                RAISE EXCEPTION 'Ride cannot complete without valid payment confirmation';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- 5. Create triggers on rides table (idempotent)
DROP TRIGGER IF EXISTS trg_auto_insert_ledger ON rides;
CREATE TRIGGER trg_auto_insert_ledger
    BEFORE UPDATE OF status ON rides
    FOR EACH ROW
    WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
    EXECUTE FUNCTION auto_insert_ledger_on_completion();

DROP TRIGGER IF EXISTS trg_check_payment ON rides;
CREATE TRIGGER trg_check_payment
    BEFORE UPDATE OF status ON rides
    FOR EACH ROW
    WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
    EXECUTE FUNCTION check_payment_completion_safety();

COMMIT;
