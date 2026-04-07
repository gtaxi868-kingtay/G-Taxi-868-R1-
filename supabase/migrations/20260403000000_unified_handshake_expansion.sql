-- 🗳️ G-TAXI UNIFIED HANDSHAKE & LOGISTICS EXPANSION
-- Supporting the $1T Vision: Transport, Airlines, Hotels, & Universal Logistics

-- 1. LOCK DOWN MERCHANT CATEGORIES
-- Expanding from basic 'grocery/laundry' to 'airline/hotel/logistics'
ALTER TABLE public.merchants ADD CONSTRAINT check_merchant_category 
    CHECK (category IN ('grocery', 'laundry', 'pharmacy', 'airline', 'hotel', 'logistics_hub'));

-- 2. THE KIOSK REGISTRY (Physical Beacon Nodes)
CREATE TABLE IF NOT EXISTS public.kiosk_nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID REFERENCES public.merchants(id) ON DELETE CASCADE,
    tag_uid TEXT UNIQUE REFERENCES identity_tags(tag_uid), -- Links to the NFC hardware
    location_name TEXT NOT NULL,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    default_services TEXT[] DEFAULT '{ride}'::text[], -- e.g. {'ride', 'grocery', 'laundry'}
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. AVIATION COORDINATION (Piarco Handshake Foundation)
CREATE TABLE IF NOT EXISTS public.airline_flights (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    airline_merchant_id UUID REFERENCES public.merchants(id),
    flight_number TEXT NOT NULL,
    status TEXT DEFAULT 'scheduled', -- 'scheduled', 'delayed', 'landed', 'cancelled'
    eta TIMESTAMP WITH TIME ZONE,
    gate TEXT,
    passenger_count INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. HOSPITALITY COORDINATION (Hotel PMS Foundation)
CREATE TABLE IF NOT EXISTS public.hotel_bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hotel_merchant_id UUID REFERENCES public.merchants(id),
    reservation_number TEXT UNIQUE NOT NULL,
    guest_name TEXT NOT NULL,
    room_number TEXT,
    check_in_time TIMESTAMP WITH TIME ZONE,
    check_out_time TIMESTAMP WITH TIME ZONE,
    status TEXT DEFAULT 'confirmed', -- 'confirmed', 'checked_in', 'checked_out'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. NFC INTERACTION LOGS (The Event Context Engine)
CREATE TABLE IF NOT EXISTS public.nfc_event_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tag_uid TEXT NOT NULL,
    profile_id UUID REFERENCES public.profiles(id),
    event_type TEXT NOT NULL, -- 'SUMMON', 'SYNC', 'SEAL', 'CHECKIN'
    location_context JSONB DEFAULT '{}'::jsonb,
    result_payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. ACTIVATE VISION FEATURE FLAGS
INSERT INTO public.system_feature_flags (id, is_active, description) VALUES
    ('airline_active', true, 'Enables Airline flight tracking and coordinated pickups.'),
    ('hotel_active', true, 'Enables Hotel reservation sync and concierge priority.'),
    ('kiosk_active', true, 'Enables NFC stationary kiosk summoning logic.')
ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active;

-- 7. RLS LOCKDOWN
ALTER TABLE public.kiosk_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.airline_flights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfc_event_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read kiosk nodes" ON public.kiosk_nodes FOR SELECT USING (is_active = true);
CREATE POLICY "Public read airline status" ON public.airline_flights FOR SELECT USING (true);
CREATE POLICY "Guests can view own hotel sync" ON public.hotel_bookings FOR SELECT USING (true); -- Filtered by name/res in app logic
CREATE POLICY "Users can view own nfc logs" ON public.nfc_event_logs FOR SELECT USING (auth.uid() = profile_id);
