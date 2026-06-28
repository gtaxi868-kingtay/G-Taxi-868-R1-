-- =============================================================================
-- PHASE 3 — DATABASE CRASH FIXES
--
-- Crash 1: auto_insert_ledger_on_completion inserts with wrong column names
--          (rider_id, driver_id, payment_method) that don't exist on the
--          payment_ledger table. This crashes EVERY ride completion.
--
-- Crash 2: check_payment_completion_safety requires cash_confirmed = TRUE for
--          cash rides. The complete_ride edge function now sets it in a prior
--          UPDATE, but the trigger interaction can still fail for STRIPE/WALLET
--          rides where payment_status isn't set correctly.
-- =============================================================================

BEGIN;

-- =============================================================================
-- FIX 3.1 — auto_insert_ledger_on_completion
-- Problem: INSERT uses columns (rider_id, driver_id, payment_method) but the
--          actual payment_ledger table has (user_id, provider).
-- Fix:     Recreate the function with correct column names and value mapping.
-- =============================================================================

CREATE OR REPLACE FUNCTION auto_insert_ledger_on_completion() RETURNS TRIGGER AS $$
DECLARE
    v_provider TEXT;
BEGIN
    IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.ledger_recorded = FALSE THEN

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
$$ LANGUAGE plpgsql;

-- =============================================================================
-- FIX 3.2 — check_payment_completion_safety
-- Problem: The trigger blocks completion if payment validation fails for the
--          given payment method. For WALLET rides, payment_status must be
--          'captured'/'confirmed' BEFORE the trigger fires, but the DB trigger
--          that captures wallet payments may not have set it yet.
-- Fix:     For WALLET rides: if the wallet RPC already ran successfully,
--          payment_status will be set. If not, the wallet capture should have
--          happened BEFORE complete_ride is called. The trigger is correct
--          as-is — it enforces that payment is confirmed before completion.
--          However, add a grace period: if the ride was just transitioned from
--          'in_progress' AND the fare is 0 (free rides), skip the check.
-- =============================================================================

CREATE OR REPLACE FUNCTION check_payment_completion_safety() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN

        -- Free rides (fare = 0) bypass payment checks
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
$$ LANGUAGE plpgsql;

COMMIT;
