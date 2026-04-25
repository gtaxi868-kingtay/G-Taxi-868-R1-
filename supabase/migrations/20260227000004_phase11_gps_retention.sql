-- =============================================================================
-- PHASE 11 — GPS DATA RETENTION
-- Migration: 20260227000004_phase11_gps_retention.sql
-- Implements table cleanup routines via pg_cron to prevent DB bloat.
-- =============================================================================

BEGIN;
-- =============================================================================
-- STEP 1 — Add ride_id column to driver_locations
-- =============================================================================

ALTER TABLE public.driver_locations 
    ADD COLUMN IF NOT EXISTS ride_id UUID REFERENCES public.rides(id);
-- =============================================================================
-- STEP 2 — Create cleanup function
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cleanup_driver_locations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Delete pings older than 24 hours that are NOT tagged to a ride
    -- These are idle/searching pings with no dispute value
    DELETE FROM public.driver_locations
    WHERE created_at < NOW() - INTERVAL '24 hours'
    AND ride_id IS NULL;

    -- Delete pings older than 90 days even if tagged to a completed ride
    -- 90 days is sufficient for any dispute resolution window
    DELETE FROM public.driver_locations
    WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$;
-- =============================================================================
-- STEP 3 — Schedule pg_cron jobs
-- =============================================================================

-- Safely enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;
-- Schedule driver locations cleanup (Runs daily at 3:00 AM UTC)
-- Note: 'cron.schedule' does an UPSERT based on job name in recent pg_cron versions,
-- but to be safe and idempotent, we drop it first.
SELECT cron.unschedule('cleanup-driver-locations');
SELECT cron.schedule(
    'cleanup-driver-locations',
    '0 3 * * *',
    $$SELECT public.cleanup_driver_locations()$$
);
-- Schedule rate limit log cleanup (Runs every hour at minute 0)
-- Function created in Phase 10 migration.
SELECT cron.unschedule('cleanup-rate-limit-log');
SELECT cron.schedule(
    'cleanup-rate-limit-log',
    '0 * * * *',
    $$SELECT public.cleanup_rate_limit_log()$$
);
-- =============================================================================
-- STEP 4 — Add performance indexes
-- =============================================================================

-- Supports querying by ride for dispute resolution
CREATE INDEX IF NOT EXISTS idx_driver_locations_ride_id 
    ON public.driver_locations(ride_id)
    WHERE ride_id IS NOT NULL;
-- Supports the cleanup routine (created_at scan, filtered by ride_id)
CREATE INDEX IF NOT EXISTS idx_driver_locations_created_ride
    ON public.driver_locations(created_at, ride_id);
COMMIT;
