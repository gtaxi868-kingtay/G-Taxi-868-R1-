-- Phase 15A fix: Make payment_ledger.ride_id nullable to support
-- wallet top-ups which have no associated ride.
-- The foreign key constraint is preserved for non-null values.

ALTER TABLE public.payment_ledger 
    ALTER COLUMN ride_id DROP NOT NULL;
-- Update RLS policy to also allow users to see their top-up ledger entries
-- (previously only matched ride-based entries via the rides table join)
DROP POLICY IF EXISTS "Users view own ledger entries" ON public.payment_ledger;
CREATE POLICY "Users view own ledger entries" ON public.payment_ledger
    FOR SELECT USING (auth.uid() = user_id);
COMMIT;
