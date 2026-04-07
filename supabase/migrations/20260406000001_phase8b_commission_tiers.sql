-- Migration: 20260406000001_phase8b_commission_tiers.sql
-- Enables the Dynamic Tiered Pricing logic for Drivers

DO $$ 
BEGIN
    -- 1. Create custom ENUM for driver commission tiers if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'driver_commission_tier') THEN
        CREATE TYPE driver_commission_tier AS ENUM ('pioneer', 'standard', 'top_earner');
    END IF;
END $$;

-- 2. Add columns to drivers table
ALTER TABLE public.drivers 
ADD COLUMN IF NOT EXISTS commission_tier driver_commission_tier DEFAULT 'standard',
ADD COLUMN IF NOT EXISTS custom_commission_rate numeric(5,2) DEFAULT NULL;

-- 3. Update existing early adopters (simulate "first 10" for test environments)
UPDATE public.drivers 
SET commission_tier = 'pioneer' 
WHERE id IN (
    SELECT id FROM public.drivers ORDER BY created_at ASC LIMIT 10
);

-- Notify schema cache update
NOTIFY pgrst, 'reload schema';
