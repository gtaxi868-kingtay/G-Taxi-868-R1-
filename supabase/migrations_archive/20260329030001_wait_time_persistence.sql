-- Migration: 20260329030000_wait_time_persistence.sql
-- Purpose: Persist arrival times and wait fees to ensure billing integrity.

ALTER TABLE public.rides 
ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS wait_fare_cents INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS wait_time_seconds INTEGER DEFAULT 0;

-- Trigger to auto-set arrived_at when status changes to 'arrived'
CREATE OR REPLACE FUNCTION set_ride_arrived_at()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'arrived' AND OLD.status != 'arrived' THEN
        NEW.arrived_at = now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_ride_arrived_at ON public.rides;
CREATE TRIGGER trigger_set_ride_arrived_at
BEFORE UPDATE ON public.rides
FOR EACH ROW
EXECUTE FUNCTION set_ride_arrived_at();
