-- Create travel tables (missing from migrations — would crash fresh deploy)
-- Extracted from live database schema on 2026-06-13

CREATE TABLE IF NOT EXISTS public.flight_inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    airline_merchant_id UUID REFERENCES public.merchants(id),
    flight_number TEXT NOT NULL,
    origin_code TEXT NOT NULL DEFAULT 'POS',
    destination_code TEXT NOT NULL,
    departure_at TIMESTAMPTZ NOT NULL,
    return_flight_number TEXT,
    return_departure_at TIMESTAMPTZ,
    seats_total INTEGER NOT NULL,
    seats_reserved INTEGER NOT NULL DEFAULT 0,
    wholesale_price_cents INTEGER NOT NULL,
    retail_price_cents INTEGER NOT NULL,
    cabin_class TEXT DEFAULT 'economy',
    route_pricing_reference JSONB DEFAULT '{}'::jsonb,
    status TEXT DEFAULT 'available' CHECK (status IN ('available','sold_out','cancelled')),
    source TEXT DEFAULT 'manual' CHECK (source IN ('manual','charter_api','cal_api')),
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.flight_inventory ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.travel_properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES public.merchants(id),
    name TEXT NOT NULL,
    destination_code TEXT NOT NULL,
    destination_name TEXT NOT NULL,
    address TEXT,
    stars INTEGER CHECK (stars >= 1 AND stars <= 5),
    room_types JSONB DEFAULT '[]'::jsonb,
    cover_image_url TEXT,
    amenities TEXT[],
    ical_urls JSONB DEFAULT '{}'::jsonb,
    last_sync_at TIMESTAMPTZ,
    sync_status TEXT DEFAULT 'pending' CHECK (sync_status IN ('pending','syncing','synced','error')),
    sync_error TEXT,
    is_active BOOLEAN DEFAULT true,
    is_equity_partner BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.travel_properties ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.travel_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    destination_code TEXT NOT NULL,
    destination_name TEXT NOT NULL,
    origin_code TEXT NOT NULL DEFAULT 'POS',
    cover_image_url TEXT,
    property_id UUID REFERENCES public.travel_properties(id),
    flight_inventory_id UUID REFERENCES public.flight_inventory(id),
    flight_info JSONB NOT NULL DEFAULT '{}'::jsonb,
    hotel_info JSONB NOT NULL DEFAULT '{}'::jsonb,
    price_per_person_cents INTEGER NOT NULL,
    wholesale_cost_cents INTEGER NOT NULL,
    max_travelers INTEGER NOT NULL DEFAULT 20,
    travelers_booked INTEGER NOT NULL DEFAULT 0,
    includes_airport_transfer BOOLEAN DEFAULT true,
    auto_generated BOOLEAN DEFAULT false,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','sold_out','expired','cancelled')),
    departure_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.travel_packages ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.travel_bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id UUID NOT NULL REFERENCES public.travel_packages(id),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    flight_inventory_id UUID REFERENCES public.flight_inventory(id),
    traveler_count INTEGER NOT NULL DEFAULT 1,
    total_cents INTEGER NOT NULL,
    platform_margin_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled','completed')),
    payment_method TEXT NOT NULL DEFAULT 'wallet' CHECK (payment_method IN ('wallet','stripe')),
    stripe_payment_intent_id TEXT,
    wallet_transaction_id UUID REFERENCES public.wallet_transactions(id),
    airport_transfer_ride_id UUID REFERENCES public.rides(id),
    passenger_names JSONB DEFAULT '[]'::jsonb,
    special_requests TEXT,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.travel_bookings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.travel_waitlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    destination_code TEXT NOT NULL,
    earliest_departure DATE,
    latest_departure DATE,
    max_price_cents INTEGER,
    notified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id, destination_code)
);

ALTER TABLE public.travel_waitlist ENABLE ROW LEVEL SECURITY;

-- RLS policies
DROP POLICY IF EXISTS "Service full access flights" ON public.flight_inventory;
CREATE POLICY "Service full access flights"
  ON public.flight_inventory FOR ALL
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service full access properties" ON public.travel_properties;
CREATE POLICY "Service full access properties"
  ON public.travel_properties FOR ALL
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Riders read active packages" ON public.travel_packages;
CREATE POLICY "Riders read active packages"
  ON public.travel_packages FOR SELECT
  TO authenticated
  USING (status = 'active');

DROP POLICY IF EXISTS "Service full access packages" ON public.travel_packages;
CREATE POLICY "Service full access packages"
  ON public.travel_packages FOR ALL
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Riders own bookings" ON public.travel_bookings;
CREATE POLICY "Riders own bookings"
  ON public.travel_bookings FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Service full access bookings" ON public.travel_bookings;
CREATE POLICY "Service full access bookings"
  ON public.travel_bookings FOR ALL
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Riders own waitlist" ON public.travel_waitlist;
CREATE POLICY "Riders own waitlist"
  ON public.travel_waitlist FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Indices
CREATE INDEX IF NOT EXISTS idx_travel_packages_destination ON public.travel_packages(destination_code, status);
CREATE INDEX IF NOT EXISTS idx_travel_packages_departure ON public.travel_packages(departure_at);
CREATE INDEX IF NOT EXISTS idx_travel_bookings_user ON public.travel_bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_travel_bookings_package ON public.travel_bookings(package_id);
CREATE INDEX IF NOT EXISTS idx_travel_waitlist_destination ON public.travel_waitlist(destination_code);
CREATE INDEX IF NOT EXISTS idx_travel_properties_destination ON public.travel_properties(destination_code);
CREATE INDEX IF NOT EXISTS idx_flight_inventory_route ON public.flight_inventory(origin_code, destination_code);
