-- Phase 4: Minimal Patch Strategy
-- Reason: Category D Failure (Lifecycle Events Not Logged)
-- Strategy: Add Trigger to Rides Table (Zero Impact to RPCs)

BEGIN;

-- 1. Create Logging Function
CREATE OR REPLACE FUNCTION log_ride_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.status IS DISTINCT FROM NEW.status) THEN
        INSERT INTO public.ride_events (
            ride_id,
            event_type,
            actor_type, -- inferred
            actor_id, -- inferred from auth.uid()
            metadata
        ) VALUES (
            NEW.id,
            'status_changed',
            'system', -- Default, or infer from auth context if possible?
            auth.uid(), -- If triggered by RPC executing as user
            jsonb_build_object(
                'old_status', OLD.status,
                'new_status', NEW.status,
                'driver_id', NEW.driver_id
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create Trigger
DROP TRIGGER IF EXISTS trg_log_ride_status ON public.rides;
CREATE TRIGGER trg_log_ride_status
    AFTER UPDATE OF status ON public.rides
    FOR EACH ROW
    EXECUTE FUNCTION log_ride_status_change();

-- 3. Post-Verification Query (Commented out in migration file, run via client)
-- Verify insert exists after update.

COMMIT;
