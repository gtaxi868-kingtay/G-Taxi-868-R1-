-- Migration: 019_fix_driver_rls.sql
-- Purpose: Fix the "Blind Driver" issue and harden location privacy

-- ============================================
-- 1. ENABLE DRIVERS TO SEE THEIR RIDES
-- ============================================
-- Problem: Currently only Riders can SELECT rides. 
-- Fix: Add policy for Drivers to SELECT rides where they are assigned.

DROP POLICY IF EXISTS "Drivers can view assigned rides" ON public.rides;

CREATE POLICY "Drivers can view assigned rides"
ON public.rides
FOR SELECT
TO authenticated
USING (
    driver_id = auth.uid()
);

-- ============================================
-- 2. ENABLE DRIVERS TO UPDATE STATUS
-- ============================================
-- Fix: Add policy for Drivers to UPDATE rides where they are assigned.

DROP POLICY IF EXISTS "Drivers can update assigned rides" ON public.rides;

CREATE POLICY "Drivers can update assigned rides"
ON public.rides
FOR UPDATE
TO authenticated
USING (
    driver_id = auth.uid()
)
WITH CHECK (
    driver_id = auth.uid()
);

-- ============================================
-- 3. HARDEN DRIVER LOCATIONS (PRIVACY)
-- ============================================
-- Problem: Currently 'Public read access' allows anyone to scrape locations.
-- Fix: Restrict SELECT to 'authenticated' only. Service Role still has full access.

DROP POLICY IF EXISTS "Public read access" ON public.driver_locations;
DROP POLICY IF EXISTS "Authenticated read access" ON public.driver_locations;

CREATE POLICY "Authenticated read access"
ON public.driver_locations
FOR SELECT
TO authenticated
USING (true);

-- Ensure Service Role still works
DROP POLICY IF EXISTS "Service role full access" ON public.driver_locations;

CREATE POLICY "Service role full access"
ON public.driver_locations
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================
-- 4. VERIFY REALTIME PUBLICATION
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND tablename = 'rides'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE rides;
    END IF;
END $$;
