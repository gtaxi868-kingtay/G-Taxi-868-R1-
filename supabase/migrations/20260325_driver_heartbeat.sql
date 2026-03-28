-- Migration: 20260325_driver_heartbeat.sql
-- G-TAXI HARDENING: Fix 14 - Driver Heartbeat Enforcement
-- Description: Automates the removal of "ghost" drivers who haven't updated their location in 5 mins.

BEGIN;

-- 1. Create the cleanup function
CREATE OR REPLACE FUNCTION public.cleanup_stale_drivers()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.drivers
    SET is_online = false,
        updated_at = NOW()
    WHERE is_online = true
      AND last_location_update < NOW() - INTERVAL '5 minutes'
      AND active_ride_id IS NULL; -- Safety: never kick a driver during a trip
END;
$$;

-- 2. NOTE FOR OPERATOR:
-- To automate this, run the following in Supabase SQL Editor:
-- SELECT cron.schedule('driver-heartbeat-cleanup', '*/5 * * * *', 'SELECT public.cleanup_stale_drivers()');

COMMIT;
