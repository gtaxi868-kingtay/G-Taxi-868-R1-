-- Phase 8A: Merchant Service Verticals & Consent Flow

-- 1. Expand Merchant Categories
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'merchant_category') THEN
        -- Using check constraint on text for flexibility if enum is locked
    END IF;
END $$;

-- 2. Merchant Services (The Menu)
CREATE TABLE IF NOT EXISTS public.merchant_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID REFERENCES public.merchants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    price_cents INTEGER NOT NULL,
    duration_minutes INTEGER DEFAULT 30,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Merchant Appointments
CREATE TABLE IF NOT EXISTS public.merchant_appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    merchant_id UUID REFERENCES public.merchants(id) ON DELETE CASCADE,
    service_id UUID REFERENCES public.merchant_services(id) ON DELETE SET NULL,
    scheduled_at TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending', 'confirmed', 'completed', 'cancelled'
    
    -- Logistics Bridge
    ride_requested BOOLEAN DEFAULT false,
    merchant_consent_status TEXT DEFAULT 'pending', -- 'pending', 'granted', 'denied'
    pickup_address TEXT,
    pickup_lat DOUBLE PRECISION,
    pickup_lng DOUBLE PRECISION,
    ride_id UUID, -- Link to actual ride record AFTER consent
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. User Service History (For AI POI Suggestions)
-- This tracks where the user GOES for services to fuel the AI "Barbers Visited" logic.
CREATE TABLE IF NOT EXISTS public.user_service_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    merchant_id UUID REFERENCES public.merchants(id) ON DELETE CASCADE,
    last_visit_at TIMESTAMPTZ DEFAULT now(),
    visit_count INTEGER DEFAULT 1,
    UNIQUE(user_id, merchant_id)
);

-- 5. Enable RLS
ALTER TABLE public.merchant_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_service_history ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies
CREATE POLICY "Everyone can view services" 
    ON public.merchant_services FOR SELECT USING (true);

CREATE POLICY "Merchants manage their own services" 
    ON public.merchant_services FOR ALL 
    USING (EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE profiles.id = auth.uid() AND profiles.merchant_id = merchant_services.merchant_id
    ));

CREATE POLICY "Riders can see their own appointments" 
    ON public.merchant_appointments FOR SELECT 
    USING (auth.uid() = rider_id);

CREATE POLICY "Riders can create appointments" 
    ON public.merchant_appointments FOR INSERT 
    WITH CHECK (auth.uid() = rider_id);

CREATE POLICY "Merchants manage appointments for their business" 
    ON public.merchant_appointments FOR ALL 
    USING (EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE profiles.id = auth.uid() AND profiles.merchant_id = merchant_appointments.merchant_id
    ));

-- 7. Realtime Support
ALTER PUBLICATION supabase_realtime ADD TABLE public.merchant_appointments;
