-- Phase 8: Ride State Machine Lock - Part 2
-- Adds missing enum states, updates trigger for post-completion flow,
-- adds CHECK constraints, creates admin_audit_log table

-- =============================================================================
-- 1. Add missing enum values (PG 15+ transactional ALTER TYPE)
-- =============================================================================
ALTER TYPE ride_status ADD VALUE IF NOT EXISTS 'waiting_queue';
ALTER TYPE ride_status ADD VALUE IF NOT EXISTS 'payment_confirmed';
ALTER TYPE ride_status ADD VALUE IF NOT EXISTS 'closed';

ALTER TYPE payment_status_enum ADD VALUE IF NOT EXISTS 'confirmed';
ALTER TYPE payment_status_enum ADD VALUE IF NOT EXISTS 'receipt_sent';

-- =============================================================================
-- 2. Add CHECK constraints
-- =============================================================================
ALTER TABLE public.rides DROP CONSTRAINT IF EXISTS rides_total_fare_check;
ALTER TABLE public.rides ADD CONSTRAINT rides_total_fare_check
  CHECK (total_fare_cents IS NULL OR total_fare_cents >= 0);

-- =============================================================================
-- 3. Create admin_audit_log table (idempotent)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  admin_id UUID NOT NULL REFERENCES auth.users(id),
  admin_email TEXT,
  action TEXT NOT NULL,
  ride_id UUID REFERENCES public.rides(id),
  target_type TEXT,
  target_id TEXT,
  previous_status TEXT,
  new_status TEXT,
  safety_override BOOLEAN DEFAULT false,
  reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  user_agent TEXT
);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_own" ON public.admin_audit_log;
CREATE POLICY "admin_select_own" ON public.admin_audit_log
  FOR SELECT USING (auth.uid() IN (
    SELECT id FROM profiles WHERE role = 'admin'
  ));

GRANT SELECT ON public.admin_audit_log TO authenticated;
GRANT INSERT ON public.admin_audit_log TO service_role;

-- =============================================================================
-- 4. Helper function for admin audit logging
-- =============================================================================
CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_admin_id UUID,
  p_admin_email TEXT,
  p_action TEXT,
  p_ride_id UUID DEFAULT NULL,
  p_previous_status TEXT DEFAULT NULL,
  p_new_status TEXT DEFAULT NULL,
  p_safety_override BOOLEAN DEFAULT false,
  p_reason TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.admin_audit_log (
    admin_id, admin_email, action, ride_id,
    previous_status, new_status, safety_override,
    reason, metadata
  ) VALUES (
    p_admin_id, p_admin_email, p_action, p_ride_id,
    p_previous_status, p_new_status, p_safety_override,
    p_reason, p_metadata
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- =============================================================================
-- 5. Update validate_ride_status_transition for post-completion flow
-- =============================================================================
CREATE OR REPLACE FUNCTION public.validate_ride_status_transition()
RETURNS TRIGGER AS $$
DECLARE
    old_status text := OLD.status::text;
    new_status text := NEW.status::text;
BEGIN
    -- Idempotency / No-op
    IF old_status = new_status THEN RETURN NEW; END IF;

    -- TERMINAL STATES (Nothing can transition OUT of these)
    IF old_status = 'closed' THEN
        RAISE EXCEPTION 'Cannot change status of a closed ride';
    END IF;
    IF old_status = 'cancelled' THEN
        RAISE EXCEPTION 'Cannot change status of a cancelled ride';
    END IF;
    IF old_status = 'blocked' THEN
        RAISE EXCEPTION 'Ride is blocked, admin intervention required';
    END IF;

    -- BLOCKED — any non-terminal state can be blocked by admin
    IF new_status = 'blocked' THEN
        IF old_status IN ('completed', 'payment_confirmed', 'closed', 'cancelled') THEN
            RAISE EXCEPTION 'Cannot block a ride that is already in a terminal state';
        END IF;
        RETURN NEW;
    END IF;

    -- requested:
    IF old_status = 'requested' AND new_status = 'searching' THEN RETURN NEW; END IF;
    IF old_status = 'requested' AND new_status = 'cancelled' THEN RETURN NEW; END IF;

    -- searching:
    IF old_status = 'searching' AND new_status = 'assigned' THEN RETURN NEW; END IF;
    IF old_status = 'searching' AND new_status = 'cancelled' THEN RETURN NEW; END IF;
    IF old_status = 'searching' AND new_status = 'expired' THEN RETURN NEW; END IF;
    IF old_status = 'searching' AND new_status = 'waiting_queue' THEN RETURN NEW; END IF;

    -- waiting_queue:
    IF old_status = 'waiting_queue' AND new_status = 'searching' THEN RETURN NEW; END IF;
    IF old_status = 'waiting_queue' AND new_status = 'cancelled' THEN RETURN NEW; END IF;
    IF old_status = 'waiting_queue' AND new_status = 'expired' THEN RETURN NEW; END IF;

    -- expired:
    IF old_status = 'expired' AND new_status = 'searching' THEN RETURN NEW; END IF;
    IF old_status = 'expired' AND new_status = 'cancelled' THEN RETURN NEW; END IF;

    -- assigned:
    IF old_status = 'assigned' AND new_status = 'arrived' THEN RETURN NEW; END IF;
    IF old_status = 'assigned' AND new_status = 'cancelled' THEN RETURN NEW; END IF;

    -- arrived:
    IF old_status = 'arrived' AND new_status = 'in_progress' THEN RETURN NEW; END IF;
    IF old_status = 'arrived' AND new_status = 'cancelled' THEN RETURN NEW; END IF;

    -- scheduled:
    IF old_status = 'scheduled' AND new_status = 'searching' THEN RETURN NEW; END IF;
    IF old_status = 'scheduled' AND new_status = 'cancelled' THEN RETURN NEW; END IF;

    -- in_progress -> completed (with enforcement)
    IF old_status = 'in_progress' AND new_status = 'completed' THEN
        IF NEW.total_fare_cents IS NULL OR NEW.total_fare_cents <= 0 THEN
            RAISE EXCEPTION 'Cannot complete ride with no fare amount set';
        END IF;
        IF NEW.payment_method = 'cash' THEN RETURN NEW; END IF;
        IF NEW.payment_method = 'card' THEN
            IF NEW.payment_status = 'captured' THEN RETURN NEW; END IF;
            RAISE EXCEPTION 'Cannot complete card ride without captured payment (Status: %)', NEW.payment_status;
        END IF;
        IF NEW.payment_method = 'wallet' THEN
            IF NEW.payment_status = 'captured' THEN RETURN NEW; END IF;
            RAISE EXCEPTION 'Cannot complete wallet ride without captured payment (Status: %)', NEW.payment_status;
        END IF;
        RAISE EXCEPTION 'Unknown payment method: %', NEW.payment_method;
    END IF;

    -- POST-COMPLETION FLOW:
    -- completed -> payment_confirmed
    IF old_status = 'completed' AND new_status = 'payment_confirmed' THEN
        IF NEW.payment_status != 'captured' AND NEW.payment_status != 'confirmed' THEN
            RAISE EXCEPTION 'Cannot confirm payment without captured/confirmed payment status (Status: %)', NEW.payment_status;
        END IF;
        RETURN NEW;
    END IF;

    -- payment_confirmed -> closed
    IF old_status = 'payment_confirmed' AND new_status = 'closed' THEN
        RETURN NEW;
    END IF;

    -- If we get here, the transition is illegal
    RAISE EXCEPTION 'Invalid Ride Status Transition: % -> %', old_status, new_status;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_ride_status ON public.rides;
CREATE TRIGGER trg_validate_ride_status
    BEFORE UPDATE OF status ON public.rides
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_ride_status_transition();
