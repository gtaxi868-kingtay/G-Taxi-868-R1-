-- Create vendor_commissions table (referenced by complete_ride index.ts:423)
-- Missing in migrations — would crash on fresh deploy.
CREATE TABLE IF NOT EXISTS public.vendor_commissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
    kiosk_node_id UUID NOT NULL,
    merchant_id UUID NOT NULL,
    staff_member_id UUID,
    commission_rate NUMERIC NOT NULL DEFAULT 0.03,
    commission_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vendor_commissions ENABLE ROW LEVEL SECURITY;

-- Create driver_scout_referrals table (referenced by ScoutReferralScreen + auto_payout trigger)
-- Missing in migrations — would crash on fresh deploy.
CREATE TABLE IF NOT EXISTS public.driver_scout_referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
    property_name TEXT NOT NULL,
    contact_phone TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','qualified','paid','expired')),
    payout_amount_cents INTEGER NOT NULL DEFAULT 50000,
    referral_code TEXT,
    wallet_txn_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.driver_scout_referrals ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_vendor_commissions_ride ON public.vendor_commissions(ride_id);
CREATE INDEX IF NOT EXISTS idx_vendor_commissions_merchant ON public.vendor_commissions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_driver_scout_driver ON public.driver_scout_referrals(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_scout_status ON public.driver_scout_referrals(status);

-- RLS policies: vendor_commissions (edge functions use service_role for CRUD)
DROP POLICY IF EXISTS "Service role manages vendor commissions" ON public.vendor_commissions;
CREATE POLICY "Service role manages vendor commissions"
  ON public.vendor_commissions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS policies: driver_scout_referrals
DROP POLICY IF EXISTS "Driver reads own referrals" ON public.driver_scout_referrals;
CREATE POLICY "Driver reads own referrals"
  ON public.driver_scout_referrals FOR SELECT
  TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Driver inserts own referrals" ON public.driver_scout_referrals;
CREATE POLICY "Driver inserts own referrals"
  ON public.driver_scout_referrals FOR INSERT
  TO authenticated
  WITH CHECK (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Service role manages scout referrals" ON public.driver_scout_referrals;
CREATE POLICY "Service role manages scout referrals"
  ON public.driver_scout_referrals FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
