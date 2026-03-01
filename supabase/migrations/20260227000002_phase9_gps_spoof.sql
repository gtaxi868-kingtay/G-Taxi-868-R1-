-- =============================================================================
-- PHASE 9 — GPS SPOOF DETECTION
-- Migration: 20260227000002_phase9_gps_spoof.sql
-- Adds spoof logging table, driver flag counts, and auto-suspend RPC.
-- =============================================================================

BEGIN;

-- =============================================================================
-- PART A1 — Create gps_spoof_log table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.gps_spoof_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id       UUID NOT NULL REFERENCES public.drivers(id),
    reported_lat    DOUBLE PRECISION NOT NULL,
    reported_lng    DOUBLE PRECISION NOT NULL,
    last_known_lat  DOUBLE PRECISION,
    last_known_lng  DOUBLE PRECISION,
    implied_speed_kmh DOUBLE PRECISION,
    time_delta_seconds DOUBLE PRECISION,
    distance_meters DOUBLE PRECISION,
    rejection_reason TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.gps_spoof_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages spoof log" ON public.gps_spoof_log;
CREATE POLICY "Service role manages spoof log"
    ON public.gps_spoof_log 
    FOR ALL 
    TO service_role
    USING (true) 
    WITH CHECK (true);

-- Indexes for querying later
CREATE INDEX IF NOT EXISTS idx_spoof_log_driver ON public.gps_spoof_log(driver_id);
CREATE INDEX IF NOT EXISTS idx_spoof_log_created ON public.gps_spoof_log(created_at);

-- =============================================================================
-- PART A2 — Add spoof control columns to drivers table
-- =============================================================================

ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS spoof_flag_count INTEGER DEFAULT 0;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS spoof_flagged_at TIMESTAMPTZ;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS spoof_suspended BOOLEAN DEFAULT false;

-- =============================================================================
-- PART A3 — Create increment_spoof_flag RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION public.increment_spoof_flag(p_driver_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.drivers
    SET 
        spoof_flag_count = spoof_flag_count + 1,
        spoof_flagged_at = NOW(),
        -- Auto-suspend after 3 flags
        spoof_suspended = CASE WHEN spoof_flag_count + 1 >= 3 THEN true ELSE spoof_suspended END,
        -- If suspended, set status offline immediately so dispatch stops pinging
        status = CASE WHEN spoof_flag_count + 1 >= 3 THEN 'offline' ELSE status END,
        is_online = CASE WHEN spoof_flag_count + 1 >= 3 THEN false ELSE is_online END
    WHERE id = p_driver_id;
END;
$$;

COMMIT;
