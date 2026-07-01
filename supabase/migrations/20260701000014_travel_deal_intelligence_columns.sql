-- Restore the "Rockefeller deal intelligence" columns on travel_packages.
--
-- These were originally added by 20260614000001_travel_package_deal_intelligence
-- (now archived in the baseline cutover) but the prod baseline shows they are NOT
-- present in production — so platform_intelligence's rate-expiry sweep
-- (checkRateExpiry: SELECT id,title,rate_expiry_at,rate_contact FROM travel_packages
--  WHERE status='active' AND rate_expiry_at <= now()+7d) returns HTTP 400
-- "column travel_packages.rate_expiry_at does not exist" on every 2-minute run.
--
-- Idempotent ADD COLUMN IF NOT EXISTS — safe on prod and on fresh replays.

ALTER TABLE public.travel_packages
  ADD COLUMN IF NOT EXISTS deal_phase    text
    CHECK (deal_phase IN ('phase_1', 'phase_2', 'phase_3')),
  ADD COLUMN IF NOT EXISTS rate_expiry_at timestamptz,
  ADD COLUMN IF NOT EXISTS rate_contact   text,
  ADD COLUMN IF NOT EXISTS rate_source    text;

-- Partial index so admin can quickly surface expiring active rates.
CREATE INDEX IF NOT EXISTS idx_travel_packages_rate_expiry
  ON public.travel_packages (rate_expiry_at)
  WHERE rate_expiry_at IS NOT NULL AND status = 'active';

COMMENT ON COLUMN public.travel_packages.rate_expiry_at IS
  'When the wholesale rate quote from the supplier lapses — admin must renegotiate before this date.';
