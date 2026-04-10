-- Migration: Glue Points (Taxi Stands & Flights)
-- Phase 50 of the G-Taxi Life OS vision.

-- 1. Taxi Stands (Physical QR Locations)
CREATE TABLE IF NOT EXISTS public.taxi_stands (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug TEXT UNIQUE NOT NULL, -- e.g. 'piarco-arrivals-1'
    name TEXT NOT NULL,
    address TEXT,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Flight Bookings (The Convenience Vault)
CREATE TABLE IF NOT EXISTS public.flight_bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    pnr_number TEXT,
    flight_number TEXT NOT NULL,
    airline_name TEXT,
    departure_time TIMESTAMPTZ NOT NULL,
    arrival_time TIMESTAMPTZ,
    origin_code TEXT, -- e.g. 'POS'
    destination_code TEXT,
    auto_transfer_enabled BOOLEAN DEFAULT true,
    ride_id UUID REFERENCES public.rides(id), -- Linked transfer ride
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.taxi_stands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flight_bookings ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Public can read active stands" ON public.taxi_stands
    FOR SELECT USING (is_active = true);

CREATE POLICY "Users can manage their own flight bookings" ON public.flight_bookings
    for all using (auth.uid() = user_id);

-- 3. Update Rides for Stand Tracking
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS taxi_stand_id UUID REFERENCES public.taxi_stands(id);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS nfc_uid TEXT UNIQUE;
