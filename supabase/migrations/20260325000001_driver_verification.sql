-- Migration: 20260325_driver_verification.sql
-- G-TAXI HARDENING: Fix 11 - Manual Driver Authorization
-- Description: Adds is_verified column and updates matching RPC to require it.

BEGIN;

-- 1. Add is_verified column if not exists
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drivers' AND column_name='is_verified') THEN
        ALTER TABLE public.drivers ADD COLUMN is_verified BOOLEAN DEFAULT false;
    END IF;
END $$;

-- 2. Backfill existing active drivers
UPDATE public.drivers SET is_verified = true WHERE status = 'active';

-- 3. Update claim_available_driver to check is_verified
CREATE OR REPLACE FUNCTION public.claim_available_driver(
    p_ride_id   UUID,
    p_rider_id  UUID   -- Added for Fix 6 (Mutual Blacklist)
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_driver_id UUID;
    v_pickup_lat DOUBLE PRECISION;
    v_pickup_lng DOUBLE PRECISION;
BEGIN
    -- Get pickup location
    SELECT pickup_lat, pickup_lng INTO v_pickup_lat, v_pickup_lng
    FROM public.rides WHERE id = p_ride_id;

    -- SELECT A DRIVER (Atomic / Skip Locked)
    -- Must be: Online, Active, Verified (Fix 11), Not Blacklisted (Fix 6)
    SELECT d.id INTO v_driver_id
    FROM public.drivers d
    JOIN public.profiles p ON d.id = p.id
    WHERE d.is_online = true
      AND d.status = 'active'
      AND d.is_verified = true -- HARDENING FIX 11
      AND d.active_ride_id IS NULL
      AND NOT EXISTS ( -- MUTUAL BLACKLIST FIX 6
          SELECT 1 FROM public.blacklists
          WHERE (blocker_id = p_rider_id AND blocked_id = d.id)
             OR (blocker_id = d.id AND blocked_id = p_rider_id)
      )
    ORDER BY d.last_location <-> st_setsrid(st_makepoint(v_pickup_lng, v_pickup_lat), 4326)
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_driver_id IS NOT NULL THEN
        UPDATE public.rides
        SET driver_id = v_driver_id,
            status = 'assigned',
            updated_at = NOW()
        WHERE id = p_ride_id;

        UPDATE public.drivers
        SET active_ride_id = p_ride_id,
            updated_at = NOW()
        WHERE id = v_driver_id;
    END IF;

    RETURN v_driver_id;
END;
$$;

COMMIT;
