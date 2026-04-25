-- =============================================================================
-- PHASE 8 — RIDE STATE MACHINE LOCK
-- Migration: 20260227000001_phase8_state_machine.sql
-- Enforces strict transitions, payment requirements, driver edit blocks, 
-- and automatic timestamps (completed_at, fare_set_at).
-- =============================================================================

BEGIN;
-- =============================================================================
-- FIX 8.1 — Rewrite validate_ride_status_transition
-- =============================================================================

CREATE OR REPLACE FUNCTION public.validate_ride_status_transition()
RETURNS TRIGGER AS $$
DECLARE
    old_status text := OLD.status::text;
    new_status text := NEW.status::text;
BEGIN
    -- Idempotency / No-op
    IF old_status = new_status THEN 
        RETURN NEW; 
    END IF;

    -- TERMINAL STATES (Nothing can transition OUT of these)
    IF old_status = 'completed' THEN 
        RAISE EXCEPTION 'Cannot change status of a completed ride'; 
    END IF;
    IF old_status = 'cancelled' THEN 
        RAISE EXCEPTION 'Cannot change status of a cancelled ride'; 
    END IF;
    IF old_status = 'blocked' THEN 
        RAISE EXCEPTION 'Ride is blocked, admin intervention required'; 
    END IF;

    -- ALLOWED TRANSITIONS
    -- requested:
    IF old_status = 'requested' AND new_status = 'searching' THEN RETURN NEW; END IF;
    IF old_status = 'requested' AND new_status = 'cancelled' THEN RETURN NEW; END IF;

    -- searching:
    IF old_status = 'searching' AND new_status = 'assigned' THEN RETURN NEW; END IF;
    IF old_status = 'searching' AND new_status = 'cancelled' THEN RETURN NEW; END IF;

    -- assigned:
    IF old_status = 'assigned' AND new_status = 'arrived' THEN RETURN NEW; END IF;
    IF old_status = 'assigned' AND new_status = 'cancelled' THEN RETURN NEW; END IF;

    -- arrived:
    IF old_status = 'arrived' AND new_status = 'in_progress' THEN RETURN NEW; END IF;
    IF old_status = 'arrived' AND new_status = 'cancelled' THEN RETURN NEW; END IF;

    -- scheduled:
    IF old_status = 'scheduled' AND new_status = 'searching' THEN RETURN NEW; END IF;
    IF old_status = 'scheduled' AND new_status = 'cancelled' THEN RETURN NEW; END IF;

    -- in_progress -> completed
    IF old_status = 'in_progress' AND new_status = 'completed' THEN
        -- 1. Fare Enforcement
        IF NEW.total_fare_cents IS NULL OR NEW.total_fare_cents <= 0 THEN
            RAISE EXCEPTION 'Cannot complete ride with no fare amount set';
        END IF;

        -- 2. Payment Enforcement
        IF NEW.payment_method = 'cash' THEN 
            -- Cash is collected by the driver in person
            RETURN NEW; 
        ELSIF NEW.payment_method = 'card' THEN
            IF NEW.payment_status = 'captured' THEN RETURN NEW; END IF;
            RAISE EXCEPTION 'Cannot complete card ride without captured payment (Status: %)', NEW.payment_status;
        ELSIF NEW.payment_method = 'wallet' THEN
            IF NEW.payment_status = 'captured' THEN RETURN NEW; END IF;
            RAISE EXCEPTION 'Cannot complete wallet ride without captured payment (Status: %)', NEW.payment_status;
        ELSE
            RAISE EXCEPTION 'Unknown payment method: %', NEW.payment_method;
        END IF;
    END IF;

    -- If we get here, the transition is illegal
    RAISE EXCEPTION 'Invalid Ride Status Transition: % -> %', old_status, new_status;
END;
$$ LANGUAGE plpgsql;
-- Recreate Trigger
DROP TRIGGER IF EXISTS trg_validate_ride_status ON public.rides;
CREATE TRIGGER trg_validate_ride_status
    BEFORE UPDATE OF status ON public.rides
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_ride_status_transition();
-- =============================================================================
-- FIX 8.2 — Fix prevent_driver_critical_edits trigger
-- =============================================================================

CREATE OR REPLACE FUNCTION public.prevent_driver_critical_edits() 
RETURNS TRIGGER AS $$
BEGIN
    -- Only restrict direct driver edits. auth.uid() IS NULL for service_role.
    IF auth.uid() IS NOT NULL AND auth.uid() = OLD.driver_id THEN
        IF NEW.total_fare_cents IS DISTINCT FROM OLD.total_fare_cents THEN 
            RAISE EXCEPTION 'Drivers cannot edit total_fare_cents'; 
        END IF;
        IF NEW.rider_id IS DISTINCT FROM OLD.rider_id THEN 
            RAISE EXCEPTION 'Drivers cannot edit rider_id'; 
        END IF;
        IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN 
            RAISE EXCEPTION 'Drivers cannot edit payment_status'; 
        END IF;
        IF NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN 
            RAISE EXCEPTION 'Drivers cannot edit payment_method'; 
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Recreate Trigger
DROP TRIGGER IF EXISTS trg_prevent_driver_edits ON public.rides;
CREATE TRIGGER trg_prevent_driver_edits 
    BEFORE UPDATE ON public.rides 
    FOR EACH ROW 
    EXECUTE FUNCTION public.prevent_driver_critical_edits();
-- =============================================================================
-- FIX 8.3 — Add fare_set_at timestamp to rides
-- =============================================================================

ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS fare_set_at TIMESTAMPTZ;
CREATE OR REPLACE FUNCTION public.set_fare_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.total_fare_cents IS NULL AND NEW.total_fare_cents IS NOT NULL AND NEW.total_fare_cents > 0 THEN
        NEW.fare_set_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_set_fare_timestamp ON public.rides;
CREATE TRIGGER trg_set_fare_timestamp
    BEFORE UPDATE OF total_fare_cents ON public.rides
    FOR EACH ROW
    EXECUTE FUNCTION public.set_fare_timestamp();
-- =============================================================================
-- FIX 8.4 — Add completed_at enforcement
-- =============================================================================

-- Ensure column exists (from 20260216040000_add_completed_at.sql context, but safe to verify)
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
CREATE OR REPLACE FUNCTION public.set_completed_at()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
        NEW.completed_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_set_completed_at ON public.rides;
CREATE TRIGGER trg_set_completed_at
    BEFORE UPDATE OF status ON public.rides
    FOR EACH ROW
    EXECUTE FUNCTION public.set_completed_at();
COMMIT;
