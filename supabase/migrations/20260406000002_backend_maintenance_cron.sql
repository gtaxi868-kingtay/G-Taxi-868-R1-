-- Migration: 20260406000002_backend_maintenance_cron.sql
-- G-TAXI HARDENING: Phase 10 - The Cleaning Service
-- Description: Automates ghost ride expiration, daily settlements, and merchant cleanup.

BEGIN;

-- ============================================================
-- 1. GHOST RIDE CLEANUP
-- ============================================================
CREATE OR REPLACE FUNCTION public.cleanup_ghost_rides()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_ride RECORD;
BEGIN
    FOR v_ride IN 
        SELECT id, rider_id 
        FROM public.rides 
        WHERE status IN ('requested', 'searching')
        AND created_at < NOW() - INTERVAL '3 minutes'
    LOOP
        UPDATE public.rides SET status = 'cancelled', updated_at = NOW() WHERE id = v_ride.id;
        INSERT INTO public.ride_events (ride_id, event_type, metadata)
        VALUES (v_ride.id, 'ai_retry_trigger', jsonb_build_object('reason', 'timeout'));
    END LOOP;
END;
$$;

-- ============================================================
-- 2. MERCHANT APPOINTMENT CLEANUP
-- ============================================================
CREATE OR REPLACE FUNCTION public.cleanup_merchant_appointments()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.merchant_appointments
    SET status = 'cancelled', merchant_consent_status = 'denied'
    WHERE status = 'pending'
    AND merchant_consent_status = 'pending'
    AND created_at < NOW() - INTERVAL '2 minutes';
END;
$$;

-- ============================================================
-- 3. TOP EARNER SETTLEMENT
-- ============================================================
CREATE OR REPLACE FUNCTION public.settle_top_earner_of_the_day()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_top_driver_id UUID;
BEGIN
    SELECT driver_id INTO v_top_driver_id
    FROM public.rides
    WHERE status = 'completed' AND updated_at > NOW() - INTERVAL '24 hours'
    AND driver_id IS NOT NULL
    GROUP BY driver_id
    ORDER BY SUM(total_fare_cents) DESC LIMIT 1;

    UPDATE public.drivers SET commission_tier = 'standard' WHERE commission_tier = 'top_earner';
    IF v_top_driver_id IS NOT NULL THEN
        UPDATE public.drivers SET commission_tier = 'top_earner' WHERE id = v_top_driver_id;
    END IF;
END;
$$;

-- ============================================================
-- 4. SCHEDULING (pg_cron)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ghost-ride-cleanup';
SELECT cron.schedule('ghost-ride-cleanup', '*/2 * * * *', $$SELECT public.cleanup_ghost_rides()$$);

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'merchant-cleanup';
SELECT cron.schedule('merchant-cleanup', '* * * * *', $$SELECT public.cleanup_merchant_appointments()$$);

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'top-earner-settlement';
SELECT cron.schedule('top-earner-settlement', '0 0 * * *', $$SELECT public.settle_top_earner_of_the_day()$$);

COMMIT;
