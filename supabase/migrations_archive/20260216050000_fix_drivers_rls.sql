-- FIX DRIVERS RLS (Verification Script Unblock)
-- Ensures Service Role can manage drivers.

BEGIN;
DO $$ BEGIN
    DROP POLICY IF EXISTS "Service Role manages drivers" ON public.drivers;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
CREATE POLICY "Service Role manages drivers" 
    ON public.drivers 
    FOR ALL 
    TO service_role 
    USING (true) 
    WITH CHECK (true);
COMMIT;
