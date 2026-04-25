-- FORCE SERVICE ROLE POLICY (Fix for Verification Script)
-- Re-applies the Service Role policy explicitly.

BEGIN;
DO $$ BEGIN
    DROP POLICY IF EXISTS "Service Role manages wallet" ON public.wallet_transactions;
    -- Also drop checking for conflicts
    DROP POLICY IF EXISTS "Service role manages wallet" ON public.wallet_transactions; 
EXCEPTION WHEN OTHERS THEN NULL; END $$;
CREATE POLICY "Service Role manages wallet" 
    ON public.wallet_transactions 
    FOR ALL 
    TO service_role 
    USING (true) 
    WITH CHECK (true);
COMMIT;
