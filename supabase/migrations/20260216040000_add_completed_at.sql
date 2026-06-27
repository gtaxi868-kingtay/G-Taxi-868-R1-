-- ADD completed_at COLUMN
-- Required for complete_ride logic

BEGIN;
ALTER TABLE public.rides 
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
COMMIT;
