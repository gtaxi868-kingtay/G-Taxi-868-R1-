-- 020_emergency_unlock.sql
-- PURPOSE: Clear table locks by removing all active ride data.
-- RUN THIS IF MIGRATIONS ARE TIMING OUT.

BEGIN;

-- 1. Clear ride execution tables (removes locks)
TRUNCATE TABLE public.ride_offers CASCADE;
TRUNCATE TABLE public.rides CASCADE;
TRUNCATE TABLE public.driver_locations CASCADE;

-- 2. Clear real-time queues (internal Supabase maintenance)
-- (Supabase usually handles this, but forcing a vacuum helps)
-- VACUUM ANALYZE;

COMMIT;
