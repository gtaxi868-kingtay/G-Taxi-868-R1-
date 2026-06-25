-- COMMANDER ECONOMIC LOOP (gap #B): commanders earn from rides by the users they
-- recruited. Decision (2026-06-24): 3% of fare, carved from the platform's 15%
-- share — the 82/15/3 split is NOT modified (driver 82% + reserve 3% untouched;
-- platform nets 12% on commander-attributed rides). Mirrors the existing
-- band/event revshare model exactly: a non-blocking ledger accrual in complete_ride.

-- 1. Attribution: tie a registered user to the commander who recruited them.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referred_by_commander_id uuid REFERENCES public.pod_commanders(id);
CREATE INDEX IF NOT EXISTS idx_profiles_referred_by_commander
  ON public.profiles(referred_by_commander_id);

-- 2. Ledger (mirrors band_revshare_ledger shape + payout columns).
CREATE TABLE IF NOT EXISTS public.commander_revshare_ledger (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commander_id   uuid NOT NULL REFERENCES public.pod_commanders(id),
  ride_id        uuid REFERENCES public.rides(id),
  rider_id       uuid,
  fare_cents     integer NOT NULL,
  revshare_cents integer NOT NULL,
  status         text NOT NULL DEFAULT 'pending',   -- pending | paid | void
  created_at     timestamptz NOT NULL DEFAULT now(),
  paid_at        timestamptz,
  wipay_transaction_id text
);
CREATE INDEX IF NOT EXISTS idx_commander_revshare_commander
  ON public.commander_revshare_ledger(commander_id, status);

ALTER TABLE public.commander_revshare_ledger ENABLE ROW LEVEL SECURITY;

-- Commander reads their OWN ledger; inserts happen via service_role (complete_ride).
DROP POLICY IF EXISTS commander_reads_own_revshare ON public.commander_revshare_ledger;
CREATE POLICY commander_reads_own_revshare ON public.commander_revshare_ledger
  FOR SELECT TO authenticated
  USING (commander_id IN (SELECT id FROM public.pod_commanders WHERE user_id = auth.uid()));

GRANT SELECT ON public.commander_revshare_ledger TO authenticated;
GRANT ALL    ON public.commander_revshare_ledger TO service_role;

-- 3. Admin-editable rate (basis points /10000; 300 = 3%).
INSERT INTO public.pricing_config (key, value_cents, description)
SELECT 'COMMANDER_REVSHARE_RATE_CENTS', 300,
       'Commander revshare per ride (bps /10000; 300 = 3% of fare, carved from platform 15%)'
WHERE NOT EXISTS (SELECT 1 FROM public.pricing_config WHERE key = 'COMMANDER_REVSHARE_RATE_CENTS');

-- 4. apply_commander_code: a logged-in user links to a commander by onboarding code.
--    Used by registration / the future universal link. One commander per user, no self-referral.
CREATE OR REPLACE FUNCTION public.apply_commander_code(p_code text)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_commander_id uuid;
  v_existing     uuid;
BEGIN
  SELECT id INTO v_commander_id
  FROM public.pod_commanders
  WHERE upper(onboarding_code) = upper(trim(p_code)) AND status = 'active';

  IF v_commander_id IS NULL THEN
    success := false; message := 'Invalid or inactive commander code.'; RETURN NEXT; RETURN;
  END IF;

  IF v_commander_id IN (SELECT id FROM public.pod_commanders WHERE user_id = auth.uid()) THEN
    success := false; message := 'You cannot register under your own code.'; RETURN NEXT; RETURN;
  END IF;

  SELECT referred_by_commander_id INTO v_existing FROM public.profiles WHERE id = auth.uid();
  IF v_existing IS NOT NULL THEN
    success := false; message := 'You are already linked to a commander.'; RETURN NEXT; RETURN;
  END IF;

  UPDATE public.profiles SET referred_by_commander_id = v_commander_id WHERE id = auth.uid();
  success := true; message := 'Linked to commander network.'; RETURN NEXT;
END $$;

REVOKE EXECUTE ON FUNCTION public.apply_commander_code(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.apply_commander_code(text) TO authenticated, service_role;
