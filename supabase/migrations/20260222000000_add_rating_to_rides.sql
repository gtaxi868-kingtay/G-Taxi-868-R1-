-- Add rating column to rides table to support Familiarity-First Dispatch (Phase 4)
ALTER TABLE public.rides 
ADD COLUMN IF NOT EXISTS rating INTEGER CHECK (rating >= 1 AND rating <= 5);

COMMENT ON COLUMN public.rides.rating IS 'The 1-5 star rating the rider gave the driver for this completed ride. Used for Tier 1 Familiarity Dispatch.';
