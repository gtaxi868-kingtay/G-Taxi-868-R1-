-- =============================================================================
-- PHASE 7 — RLS CLEANUP
-- Fix: SUPABASE_PRODUCTION_REPAIR.sql created "Drivers are publicly viewable"
--      which allows ANY authenticated user to read ALL driver profiles, exposing
--      names, phone numbers, and emails. This migration drops that policy and
--      ensures Phase 7's correct policies are in place.
-- =============================================================================

BEGIN;

-- =============================================================================
-- FIX 7.1 — profiles table: remove permissive policies
-- =============================================================================

-- Remove the super-permissive policy created by SUPABASE_PRODUCTION_REPAIR.sql
DROP POLICY IF EXISTS "Drivers are publicly viewable" ON public.profiles;

-- Remove old-named policies to avoid duplicates with Phase 7's new names
DROP POLICY IF EXISTS "Users can view own profile"    ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile"  ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile"  ON public.profiles;

-- Ensure Phase 7 policies exist (re-add if SUPABASE_PRODUCTION_REPAIR dropped them)
DROP POLICY IF EXISTS "Own profile read"              ON public.profiles;
DROP POLICY IF EXISTS "Own profile update"            ON public.profiles;
DROP POLICY IF EXISTS "Driver sees active rider"      ON public.profiles;
DROP POLICY IF EXISTS "Rider sees active driver"      ON public.profiles;
DROP POLICY IF EXISTS "Service role full access profiles" ON public.profiles;

-- Own profile: read
CREATE POLICY "Own profile read"
    ON public.profiles
    FOR SELECT
    USING (id = auth.uid());

-- Own profile: update
CREATE POLICY "Own profile update"
    ON public.profiles
    FOR UPDATE
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- Driver can read their currently assigned rider's profile
CREATE POLICY "Driver sees active rider"
    ON public.profiles
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.rides
            WHERE rides.driver_id = auth.uid()
              AND rides.rider_id  = profiles.id
              AND rides.status    IN ('assigned', 'arrived', 'in_progress')
        )
    );

-- Rider can read their currently assigned driver's profile
CREATE POLICY "Rider sees active driver"
    ON public.profiles
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.rides
            WHERE rides.rider_id  = auth.uid()
              AND rides.driver_id = profiles.id
              AND rides.status    IN ('assigned', 'arrived', 'in_progress')
        )
    );

-- Service role full access
CREATE POLICY "Service role full access profiles"
    ON public.profiles
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- =============================================================================
-- FIX 7.2 — ride_events table: append-only for regular users
-- =============================================================================

-- Ensure ride_events has NO UPDATE or DELETE policies for authenticated users
-- Only service_role may INSERT
-- Users may SELECT their own ride events only

-- Drop any existing permissive policies
DROP POLICY IF EXISTS "Users see events for their rides" ON public.ride_events;
DROP POLICY IF EXISTS "Riders view events"               ON public.ride_events;
DROP POLICY IF EXISTS "Service role only for ride_events" ON public.ride_events;

-- SELECT: own rides only (rider or driver)
CREATE POLICY "Users see events for their rides"
    ON public.ride_events
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.rides
            WHERE rides.id = ride_events.ride_id
              AND (rides.rider_id = auth.uid()
                   OR rides.driver_id = auth.uid())
        )
    );

-- INSERT: service_role only
CREATE POLICY "Service role only for ride_events"
    ON public.ride_events
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- =============================================================================
-- FIX 7.3 — payment_ledger table: read-only for users
-- =============================================================================

DROP POLICY IF EXISTS "Users view own ledger entries" ON public.payment_ledger;
DROP POLICY IF EXISTS "No direct inserts by users"     ON public.payment_ledger;

-- SELECT: own records only
CREATE POLICY "Users view own ledger entries"
    ON public.payment_ledger
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- INSERT: explicitly denied for authenticated (service_role only)
CREATE POLICY "No direct inserts by users"
    ON public.payment_ledger
    FOR INSERT
    TO authenticated
    WITH CHECK (false);

-- =============================================================================
-- FIX 7.4 — drivers table: ensure map view does not leak personal data
-- =============================================================================

-- Drop and recreate drivers_map_view to ensure it only exposes safe columns
DROP VIEW IF EXISTS public.drivers_map_view;

CREATE VIEW public.drivers_map_view
    WITH (security_invoker = false)
AS
    SELECT
        id,
        lat,
        lng,
        heading,
        is_online
    FROM public.drivers
    WHERE is_online = true;

REVOKE ALL ON public.drivers_map_view FROM PUBLIC;
GRANT SELECT ON public.drivers_map_view TO authenticated;

COMMIT;
