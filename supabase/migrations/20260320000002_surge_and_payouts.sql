-- Migration: 20260320000002_surge_and_payouts.sql
-- Enables dynamic pricing and professional financial settlements.

BEGIN;

-- 1. Surge Pricing Zones
CREATE TABLE IF NOT EXISTS public.pricing_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    boundary_geojson JSONB NOT NULL, -- GeoJSON polygon
    multiplier DECIMAL(3,2) DEFAULT 1.0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Payout Requests
CREATE TABLE IF NOT EXISTS public.payout_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
    bank_details JSONB, -- For local T&T bank transfers
    rejection_reason TEXT,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Security (RLS)
ALTER TABLE public.pricing_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active surge" ON public.pricing_zones
    FOR SELECT USING (is_active = true);

CREATE POLICY "Drivers can view own payouts" ON public.payout_requests
    FOR SELECT USING (driver_id = auth.uid());

CREATE POLICY "Drivers can create payout requests" ON public.payout_requests
    FOR INSERT WITH CHECK (driver_id = auth.uid());

CREATE POLICY "Admins full access surge" ON public.pricing_zones
    FOR ALL TO authenticated USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
    );

CREATE POLICY "Admins full access payouts" ON public.payout_requests
    FOR ALL TO authenticated USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
    );

COMMIT;
