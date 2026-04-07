-- Migration: 20260401020100_driver_stop_rls.sql
-- Phase 15 Fix 15.2 — Grant drivers access to view and interact with ride stops.

DROP POLICY IF EXISTS "Drivers see assigned ride stops" ON ride_stops;
CREATE POLICY "Drivers see assigned ride stops" ON ride_stops
    FOR SELECT USING (
        ride_id IN (SELECT id FROM rides WHERE driver_id = auth.uid())
    );

-- Drivers don't insert stops (Riders do), but Drivers update wait times
DROP POLICY IF EXISTS "Drivers update wait times" ON ride_stops;
CREATE POLICY "Drivers update wait times" ON ride_stops
    FOR UPDATE USING (
        ride_id IN (SELECT id FROM rides WHERE driver_id = auth.uid())
    ) WITH CHECK (
        ride_id IN (SELECT id FROM rides WHERE driver_id = auth.uid())
    );
