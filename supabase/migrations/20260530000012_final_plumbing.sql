-- Fix 1: Add created_by to merchants
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);

-- Fix 2: Realtime publications
ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.vertical_settings;

-- Fix 3: RLS Policy for Ride Offers
DROP POLICY IF EXISTS "Riders see offers on their rides" ON public.ride_offers;
CREATE POLICY "Riders see offers on their rides" ON public.ride_offers
  FOR SELECT USING (
    ride_id IN (SELECT id FROM rides WHERE rider_id = auth.uid())
  );
