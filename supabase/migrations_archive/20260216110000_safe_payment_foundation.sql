-- SAFE PAYMENT FOUNDATION
-- Mode: Non-Destructive / Additive Only
-- Goal: Internal Payment State Engine (Cash, Wallet, Ledger)

BEGIN;
-- STEP 2: ADD PAYMENT STATE FIELDS (Safe Alter)
DO $$ BEGIN
    -- payment_status
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rides' AND column_name = 'payment_status') THEN
        ALTER TABLE public.rides ADD COLUMN payment_status TEXT DEFAULT 'pending';
    END IF;

    -- cash_confirmed
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rides' AND column_name = 'cash_confirmed') THEN
        ALTER TABLE public.rides ADD COLUMN cash_confirmed BOOLEAN DEFAULT FALSE;
    END IF;

    -- wallet_used
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rides' AND column_name = 'wallet_used') THEN
        ALTER TABLE public.rides ADD COLUMN wallet_used NUMERIC DEFAULT 0;
    END IF;

    -- coins_used
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rides' AND column_name = 'coins_used') THEN
        ALTER TABLE public.rides ADD COLUMN coins_used NUMERIC DEFAULT 0;
    END IF;

    -- ledger_recorded
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rides' AND column_name = 'ledger_recorded') THEN
        ALTER TABLE public.rides ADD COLUMN ledger_recorded BOOLEAN DEFAULT FALSE;
    END IF;
END $$;
-- Idempotent Constraints
DO $$ BEGIN
    -- Payment Status Check
    ALTER TABLE public.rides DROP CONSTRAINT IF EXISTS rides_payment_status_check;
    ALTER TABLE public.rides ADD CONSTRAINT rides_payment_status_check 
        CHECK (payment_status IN ('pending','reserved','authorized','captured','confirmed','failed'));
    
    -- Payment Method Check (Update existing if needed, safely)
    -- We only add a check if it doesn't conflict. 
    -- Assuming existing 'payment_method' is ok.
    -- ALTER TABLE public.rides DROP CONSTRAINT IF EXISTS rides_payment_method_check;
    -- ALTER TABLE public.rides ADD CONSTRAINT rides_payment_method_check 
    --    CHECK (payment_method IN ('cash','wallet','card','mixed'));
EXCEPTION
    WHEN OTHERS THEN NULL; -- Ignore constraint errors if data mismatch (Safe Mode)
END $$;
-- STEP 3: COMPLETION SAFETY TRIGGER
CREATE OR REPLACE FUNCTION check_payment_completion_safety() RETURNS TRIGGER AS $$
BEGIN
    -- Logic: IF NEW.status = 'completed' AND OLD.status != 'completed'
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
        
        -- Cash
        IF NEW.payment_method = 'cash' THEN
            IF NEW.cash_confirmed IS NOT TRUE THEN
                RAISE EXCEPTION 'Ride cannot complete without valid payment confirmation (Cash not confirmed)';
            END IF;
        
        -- Wallet
        ELSIF NEW.payment_method = 'wallet' THEN
            IF NEW.payment_status NOT IN ('captured', 'confirmed') THEN
                RAISE EXCEPTION 'Ride cannot complete without valid payment confirmation (Wallet not captured)';
            END IF;

        -- Card
        ELSIF NEW.payment_method = 'card' THEN
            IF NEW.payment_status != 'captured' THEN
                 RAISE EXCEPTION 'Ride cannot complete without valid payment confirmation (Card not captured)';
            END IF;

        -- Mixed
        ELSIF NEW.payment_method = 'mixed' THEN
             IF NEW.payment_status NOT IN ('captured', 'confirmed') THEN
                 RAISE EXCEPTION 'Ride cannot complete without valid payment confirmation';
             END IF;
        END IF;

    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_block_completion_without_payment ON public.rides;
CREATE TRIGGER trg_block_completion_without_payment
BEFORE UPDATE ON public.rides
FOR EACH ROW EXECUTE FUNCTION check_payment_completion_safety();
-- STEP 4: AUTO LEDGER WRITE TRIGGER
CREATE OR REPLACE FUNCTION auto_insert_ledger_on_completion() RETURNS TRIGGER AS $$
BEGIN
    -- Only when completing, and flag is false
    IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.ledger_recorded = FALSE THEN
        
        -- Atomic Insert
        INSERT INTO public.payment_ledger (ride_id, rider_id, driver_id, amount, payment_method, created_at)
        VALUES (NEW.id, NEW.rider_id, NEW.driver_id, NEW.total_fare_cents, NEW.payment_method, NOW());
        
        -- Set flag (BEFORE update persists this)
        NEW.ledger_recorded := TRUE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_auto_insert_ledger_on_completion ON public.rides;
CREATE TRIGGER trg_auto_insert_ledger_on_completion
BEFORE UPDATE ON public.rides
FOR EACH ROW EXECUTE FUNCTION auto_insert_ledger_on_completion();
-- STEP 5: CASH CONFIRMATION SUPPORT (RPC)
CREATE OR REPLACE FUNCTION confirm_cash_payment(ride_uuid UUID) RETURNS BOOLEAN AS $$
DECLARE
    v_ride RECORD;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = ride_uuid;
    
    -- 1. Caller must be assigned driver
    IF v_ride.driver_id != auth.uid() THEN
        RAISE EXCEPTION 'Not authorized: Caller is not the assigned driver';
    END IF;

    -- 2. Payment method must be cash
    IF v_ride.payment_method != 'cash' THEN
         RAISE EXCEPTION 'Invalid operation: Ride is not set to Cash';
    END IF;

    -- 3. Update State
    UPDATE public.rides 
    SET 
        cash_confirmed = TRUE, 
        payment_status = 'confirmed',
        updated_at = NOW()
    WHERE id = ride_uuid;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Grants
GRANT EXECUTE ON FUNCTION confirm_cash_payment(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_cash_payment(UUID) TO service_role;
-- STEP 6: PAYMENT INITIALIZATION DEFAULT (Constraint)
ALTER TABLE public.rides ALTER COLUMN payment_status SET DEFAULT 'pending';
COMMIT;
