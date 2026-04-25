-- Fix RLS policies to use user_id instead of id for the drivers table
-- Since the Auth UID is stored in user_id, not the random id primary key.

BEGIN;
DROP POLICY IF EXISTS "Driver reads own record" ON public.drivers;
DROP POLICY IF EXISTS "Drivers update own status" ON public.drivers;
CREATE POLICY "Driver reads own record"
    ON public.drivers
    FOR SELECT
    USING (user_id = auth.uid());
CREATE POLICY "Drivers update own status"
    ON public.drivers
    FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
COMMIT;
