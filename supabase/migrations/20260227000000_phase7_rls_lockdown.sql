-- =============================================================================
-- PHASE 7 — RLS AND DATA PRIVACY LOCKDOWN
-- Migration: 20260227000000_phase7_rls_lockdown.sql
-- Safe to re-run: every DROP uses IF EXISTS. Entire file in one transaction.
--
-- Schema facts confirmed from 20260212_rebuild_complete_schema.sql:
--   drivers.id         = auth.users(id)   ← PRIMARY auth link
--   drivers.user_id    = auth.users(id)   ← REDUNDANT legacy column (ignored here)
--   driver_locations.driver_id references drivers(id)
--   ride_offers.driver_id references drivers(id)
--   rides.driver_id    references drivers(id)
--
-- Because drivers.id IS the auth UID, all policies use driver_id = auth.uid()
-- directly — no subquery needed. The old (SELECT id FROM drivers WHERE user_id =
-- auth.uid()) subquery is replaced everywhere for correctness and performance.
-- =============================================================================

BEGIN;
-- =============================================================================
-- FIX 7.1 — profiles table
-- Problem: "Public read profiles" allows any authenticated user to read ALL rows.
-- =============================================================================

-- Drop the permissive policies by every name they may have been created under
DROP POLICY IF EXISTS "Public read profiles"          ON public.profiles;
DROP POLICY IF EXISTS "Users can view all profiles"   ON public.profiles;
-- "Users can view own profile" already exists from the original migration.
-- Drop and recreate it cleanly so it remains the canonical policy.
DROP POLICY IF EXISTS "Users can view own profile"    ON public.profiles;
DROP POLICY IF EXISTS "Own profile read"              ON public.profiles;
DROP POLICY IF EXISTS "Driver sees active rider"      ON public.profiles;
DROP POLICY IF EXISTS "Rider sees active driver"      ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile"  ON public.profiles;
DROP POLICY IF EXISTS "Own profile update"            ON public.profiles;
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
-- Driver can read the profile of their currently assigned rider.
-- Condition: there is an active ride where this driver is the driver
--            and the profile being read belongs to the rider.
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
-- Rider can read the profile of their currently assigned driver.
-- The driver's profile row lives in profiles (same table — id = auth.users id).
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
-- Service role keeps full access (may already exist — safe to recreate)
DROP POLICY IF EXISTS "Service role full access profiles" ON public.profiles;
CREATE POLICY "Service role full access profiles"
    ON public.profiles
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
-- =============================================================================
-- FIX 7.2 — drivers table
-- Problem: "Public read drivers" exposes phone numbers, plate numbers, etc.
-- =============================================================================

-- Drop the permissive read policy
DROP POLICY IF EXISTS "Public read drivers"               ON public.drivers;
-- Drop old policies we will recreate cleanly
DROP POLICY IF EXISTS "Drivers update own status"         ON public.drivers;
DROP POLICY IF EXISTS "Driver reads own record"           ON public.drivers;
DROP POLICY IF EXISTS "Rider reads assigned driver"       ON public.drivers;
-- "Service role manages drivers" and "Service Role manages drivers" both exist
-- from different migrations — drop all variants and recreate once.
DROP POLICY IF EXISTS "Service role manages drivers"      ON public.drivers;
DROP POLICY IF EXISTS "Service Role manages drivers"      ON public.drivers;
-- Drivers can read their own complete record
CREATE POLICY "Driver reads own record"
    ON public.drivers
    FOR SELECT
    USING (id = auth.uid());
-- Rider can read a driver's record only while that driver is on their active ride
CREATE POLICY "Rider reads assigned driver"
    ON public.drivers
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.rides
            WHERE rides.rider_id  = auth.uid()
              AND rides.driver_id = drivers.id
              AND rides.status    IN ('assigned', 'arrived', 'in_progress')
        )
    );
-- Drivers update their own status / location columns
CREATE POLICY "Drivers update own status"
    ON public.drivers
    FOR UPDATE
    TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());
-- Service role full access (dispatch, admin operations)
CREATE POLICY "Service role manages drivers"
    ON public.drivers
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
-- ── Map view: expose only safe columns for the rider map screen ──────────────
-- This SECURITY DEFINER view lets the app show nearby cars (is_online, lat, lng,
-- heading) without leaking phone numbers, plate numbers, or personal data.
-- Access is granted to authenticated via a GRANT — not a policy on the view
-- itself, since views use the definer's privileges unless RLS is enabled.

DROP VIEW IF EXISTS public.drivers_map_view;
CREATE VIEW public.drivers_map_view
    WITH (security_invoker = false)   -- definer privileges; underlying RLS bypassed
AS
    SELECT
        id,
        lat,
        lng,
        heading,
        is_online
    FROM public.drivers
    WHERE is_online = true;
-- only show online drivers on the map

-- Revoke wide access and grant only to authenticated users
REVOKE ALL ON public.drivers_map_view FROM PUBLIC;
GRANT SELECT ON public.drivers_map_view TO authenticated;
-- =============================================================================
-- FIX 7.3 — driver_locations table
-- Problem: "Authenticated read locations" lets any logged-in user read ALL
--          historical driver GPS pings — including rides they have nothing to do with.
-- Schema: driver_locations.driver_id references drivers(id)
--         There is NO user_id column — driver_id IS the FK to drivers.
-- =============================================================================

-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Authenticated read locations"    ON public.driver_locations;
-- Drop any prior Phase 7 attempts to allow clean re-run
DROP POLICY IF EXISTS "Rider reads active driver location" ON public.driver_locations;
DROP POLICY IF EXISTS "Driver reads own location history"  ON public.driver_locations;
-- Riders may only read location rows for their own currently active rides.
-- This covers the live tracking polling the rider app does during a trip.
CREATE POLICY "Rider reads active driver location"
    ON public.driver_locations
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.rides
            WHERE rides.rider_id  = auth.uid()
              AND rides.driver_id = driver_locations.driver_id
              AND rides.status    IN ('assigned', 'arrived', 'in_progress')
        )
    );
-- Drivers can read their own location ping history
-- (driver_locations.driver_id = drivers.id = auth.uid())
CREATE POLICY "Driver reads own location history"
    ON public.driver_locations
    FOR SELECT
    USING (driver_id = auth.uid());
-- "Service write locations" remains as-is (INSERT for service_role only).
-- Confirm it exists; recreate if not.
DROP POLICY IF EXISTS "Service write locations"         ON public.driver_locations;
CREATE POLICY "Service write locations"
    ON public.driver_locations
    FOR INSERT
    TO service_role
    WITH CHECK (true);
-- =============================================================================
-- FIX 7.4 — rides table
-- Problem 1: "Riders insert own rides" lacks WITH CHECK — rider_id can be spoofed.
-- Problem 2: "Riders update own rides" is too broad — riders can change status,
--            payment_method, and other sensitive columns after a ride is created.
-- =============================================================================

-- Fix 7.4.1 — Tighten the insert policy
DROP POLICY IF EXISTS "Riders insert own rides"         ON public.rides;
CREATE POLICY "Riders insert own rides"
    ON public.rides
    FOR INSERT
    WITH CHECK (rider_id = auth.uid());
-- Fix 7.4.2 — Replace broad update with narrow cancel-only update
-- Riders are only allowed to cancel their own ride, and only when it is not
-- already completed or cancelled. The DB-level trigger
-- trg_validate_ride_status (from 20260215_production_hardening.sql) provides
-- a second enforcement layer for valid transitions.
DROP POLICY IF EXISTS "Riders update own rides"         ON public.rides;
DROP POLICY IF EXISTS "Riders cancel own rides"         ON public.rides;
CREATE POLICY "Riders cancel own rides"
    ON public.rides
    FOR UPDATE
    USING (
        rider_id = auth.uid()
        AND status NOT IN ('completed', 'cancelled')
    )
    WITH CHECK (
        rider_id = auth.uid()
        AND status = 'cancelled'
    );
-- All other ride policies ("Riders see own rides", "Drivers see assigned rides",
-- "Drivers update status only", "Service role full access rides") are untouched.


-- =============================================================================
-- FIX 7.5 — wallet_transactions table
-- Problem: No explicit DENY for authenticated INSERT, making the gap invisible
--          in policy audits and pg_policies queries.
-- =============================================================================

-- Only add the explicit deny if the table exists. Some earlier migrations may
-- not have created it yet. We use DO $$ to guard safely.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public'
                 AND table_name   = 'wallet_transactions') THEN

        EXECUTE 'DROP POLICY IF EXISTS "No authenticated inserts wallet_transactions" ON public.wallet_transactions';
        EXECUTE 'DROP POLICY IF EXISTS "Deny authenticated insert wallet_transactions" ON public.wallet_transactions';

        EXECUTE $pol$
            CREATE POLICY "Deny authenticated insert wallet_transactions"
                ON public.wallet_transactions
                FOR INSERT
                TO authenticated
                WITH CHECK (false)
        $pol$;

    END IF;
END $$;
-- =============================================================================
-- FIX 7.6 — ride_offers table
-- Analysis: drivers.id = auth.uid() (confirmed from schema — PRIMARY KEY
--           references auth.users(id)).
--           The old policies used `(SELECT id FROM drivers WHERE user_id = auth.uid())`
--           which works because user_id is a redundant copy of the same UUID, but:
--             (a) it's a correlated subquery on every policy evaluation
--             (b) it's inconsistent with every other policy in the schema
--           Fix: replace with the direct equality driver_id = auth.uid()
--           which is correct and fast.
-- =============================================================================

-- Drop both old policies (subquery-based)
DROP POLICY IF EXISTS "Drivers see own offers"          ON public.ride_offers;
DROP POLICY IF EXISTS "Drivers respond offers"          ON public.ride_offers;
-- Drop any prior Phase 7 attempts
DROP POLICY IF EXISTS "Drivers view own offers"         ON public.ride_offers;
DROP POLICY IF EXISTS "Drivers update own offers"       ON public.ride_offers;
-- Drivers can SELECT offers assigned to them
-- driver_id in ride_offers references drivers(id) = auth.uid()
CREATE POLICY "Drivers view own offers"
    ON public.ride_offers
    FOR SELECT
    USING (driver_id = auth.uid());
-- Drivers can UPDATE (accept/decline) their own offers
CREATE POLICY "Drivers update own offers"
    ON public.ride_offers
    FOR UPDATE
    USING (driver_id = auth.uid())
    WITH CHECK (driver_id = auth.uid());
-- "Service role offers" is untouched.

COMMIT;
