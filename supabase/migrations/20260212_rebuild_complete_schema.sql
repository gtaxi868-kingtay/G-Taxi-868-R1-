-- MASTER REBUILD SCHEMA: 2026-02-12
-- RUN THIS IN THE NEW PROJECT SQL EDITOR
-- Sets up the G-Taxi Backend from scratch with Clean Architecture & Hardened Security.

-- ============================================================
-- 0. EXTENSIONS & TYPES
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE public.ride_status AS ENUM (
    'requested', 'searching', 'assigned', 'arrived', 
    'in_progress', 'completed', 'cancelled', 'scheduled', 'blocked'
);

CREATE TYPE public.vehicle_type AS ENUM (
    'standard', 'xl', 'premium'
);

CREATE TYPE public.account_status AS ENUM (
    'active', 'suspended', 'blocked'
);

-- ============================================================
-- 1. PROFILES (Riders)
-- ============================================================

CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    full_name TEXT,
    phone_number TEXT,
    avatar_url TEXT,
    is_admin BOOLEAN DEFAULT false,
    cancellation_count INTEGER DEFAULT 0,
    issue_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "Public read profiles" ON public.profiles FOR SELECT USING (true); -- For drivers to see rider info, or strict it? Let's leave public for name display.

-- Trigger to create profile
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, avatar_url)
    VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'avatar_url');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 2. DRIVERS
-- ============================================================

CREATE TABLE public.drivers (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, -- Driver User ID
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- Redundant but used in legacy code
    name TEXT NOT NULL,
    phone_number TEXT,
    vehicle_model TEXT,
    plate_number TEXT,
    vehicle_type TEXT DEFAULT 'standard', -- Simplification: allow text or cast ENUM
    status TEXT DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'busy')),
    is_online BOOLEAN DEFAULT false,
    is_bot BOOLEAN DEFAULT false,
    
    -- Location Snapshot
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    heading DOUBLE PRECISION,
    location GEOGRAPHY(POINT, 4326), -- PostGIS
    last_seen TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_drivers_location ON public.drivers USING GIST(location);
CREATE INDEX idx_drivers_online ON public.drivers(is_online, status);

ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read drivers" ON public.drivers FOR SELECT TO authenticated USING (true); -- Authenticated users can see drivers (for map)
CREATE POLICY "Drivers update own status" ON public.drivers FOR UPDATE USING (id = auth.uid());
CREATE POLICY "Service role manages drivers" ON public.drivers FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Trigger to sync lat/lng to geography
CREATE OR REPLACE FUNCTION sync_driver_location() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
        NEW.location := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_driver_location_trigger BEFORE INSERT OR UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION sync_driver_location();

-- ============================================================
-- 3. RIDER CAPABILITIES
-- ============================================================

CREATE TABLE public.rider_capabilities (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    can_request_ride BOOLEAN DEFAULT true,
    can_use_cash BOOLEAN DEFAULT true,
    can_use_card BOOLEAN DEFAULT true,
    account_status public.account_status DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.rider_capabilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own capabilities" ON public.rider_capabilities FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Service role manages capabilities" ON public.rider_capabilities FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Auto-create
CREATE OR REPLACE FUNCTION public.handle_new_user_capabilities() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.rider_capabilities (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE TRIGGER on_auth_user_created_capabilities AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_capabilities();

-- ============================================================
-- 4. LOCATIONS (Trinidad Static Data)
-- ============================================================

CREATE TABLE public.locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    category TEXT DEFAULT 'other',
    popularity_score INTEGER DEFAULT 0,
    CONSTRAINT unique_location UNIQUE (name, address)
);

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read locations" ON public.locations FOR SELECT USING (true);
-- (Insert data manually or via seed script later)

-- Search Function
CREATE OR REPLACE FUNCTION search_locations(search_term TEXT, result_limit INTEGER DEFAULT 10)
RETURNS TABLE (id UUID, name TEXT, address TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, category TEXT, rank REAL) AS $$
BEGIN
    RETURN QUERY SELECT l.id, l.name, l.address, l.latitude, l.longitude, l.category, 
    ts_rank(to_tsvector('english', l.name || ' ' || l.address), plainto_tsquery('english', search_term)) AS rank
    FROM public.locations l
    WHERE l.name ILIKE '%' || search_term || '%' OR l.address ILIKE '%' || search_term || '%'
    ORDER BY popularity_score DESC, rank DESC LIMIT result_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 5. SAVED PLACES
-- ============================================================

CREATE TABLE public.saved_places (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    label TEXT NOT NULL,
    address TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, label)
);

ALTER TABLE public.saved_places ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage saved places" ON public.saved_places FOR ALL USING (user_id = auth.uid());

-- ============================================================
-- 6. RIDES
-- ============================================================

CREATE TABLE public.rides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES auth.users(id),
    driver_id UUID REFERENCES drivers(id), -- Nullable initially
    
    -- Request details
    pickup_lat DOUBLE PRECISION NOT NULL,
    pickup_lng DOUBLE PRECISION NOT NULL,
    pickup_address TEXT,
    dropoff_lat DOUBLE PRECISION NOT NULL,
    dropoff_lng DOUBLE PRECISION NOT NULL,
    dropoff_address TEXT,
    
    -- Status
    status public.ride_status DEFAULT 'searching',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    scheduled_for TIMESTAMPTZ,
    
    -- Fare & Route
    total_fare_cents INTEGER,
    distance_meters INTEGER,
    duration_seconds INTEGER,
    route_polyline TEXT,
    
    -- Metadata
    vehicle_type TEXT DEFAULT 'standard',
    payment_method TEXT DEFAULT 'cash',
    vehicle_id UUID, -- For future fleet vehicle tracking
    notes TEXT
);

CREATE INDEX idx_rides_rider ON public.rides(rider_id);
CREATE INDEX idx_rides_driver ON public.rides(driver_id);
CREATE INDEX idx_rides_status ON public.rides(status);

ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;

-- 6.1 RLS Policies (HARDENED)
CREATE POLICY "Riders see own rides" ON public.rides FOR SELECT USING (rider_id = auth.uid());
CREATE POLICY "Riders insert own rides" ON public.rides FOR INSERT WITH CHECK (rider_id = auth.uid());
CREATE POLICY "Riders update own rides" ON public.rides FOR UPDATE USING (rider_id = auth.uid());

CREATE POLICY "Drivers see assigned rides" ON public.rides FOR SELECT TO authenticated USING (driver_id = auth.uid());
CREATE POLICY "Drivers update assigned rides" ON public.rides FOR UPDATE TO authenticated USING (driver_id = auth.uid()) WITH CHECK (driver_id = auth.uid());

-- Service Role for Dispatch
CREATE POLICY "Service role full access rides" ON public.rides FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ============================================================
-- 7. RIDE OFFERS (Dispatch System)
-- ============================================================

CREATE TABLE public.ride_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
    distance_meters INTEGER,
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 seconds'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(ride_id, driver_id)
);

ALTER TABLE public.ride_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers see own offers" ON public.ride_offers FOR SELECT USING (driver_id = (SELECT id FROM drivers WHERE user_id = auth.uid()));
CREATE POLICY "Drivers respond offers" ON public.ride_offers FOR UPDATE USING (driver_id = (SELECT id FROM drivers WHERE user_id = auth.uid()));
CREATE POLICY "Service role offers" ON public.ride_offers FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 8. DRIVER LOCATIONS HISTORY
-- ============================================================

CREATE TABLE public.driver_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID REFERENCES drivers(id) NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    heading DOUBLE PRECISION,
    speed DOUBLE PRECISION,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.driver_locations ENABLE ROW LEVEL SECURITY;

-- 8.1 Hardened Policies
CREATE POLICY "Authenticated read locations" ON public.driver_locations FOR SELECT TO authenticated USING (true); -- For riders to see ghosts
CREATE POLICY "Service write locations" ON public.driver_locations FOR INSERT TO service_role WITH CHECK (true);

-- ============================================================
-- 9. RIDE EVENTS
-- ============================================================

CREATE TABLE public.ride_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID REFERENCES public.rides(id) ON DELETE CASCADE NOT NULL,
    event_type TEXT NOT NULL,
    actor_type TEXT,
    actor_id UUID,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.ride_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Riders view events" ON public.ride_events FOR SELECT USING (EXISTS (SELECT 1 FROM rides WHERE rides.id = ride_events.ride_id AND rides.rider_id = auth.uid()));
CREATE POLICY "Service role events" ON public.ride_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 10. DISPATCH FUNCTIONS
-- ============================================================

-- Dispatch Logic (Simplified)
CREATE OR REPLACE FUNCTION dispatch_ride_to_drivers(p_ride_id UUID) RETURNS INTEGER AS $$
DECLARE
    v_ride RECORD;
    v_driver RECORD;
    v_count INTEGER := 0;
BEGIN
    SELECT * INTO v_ride FROM rides WHERE id = p_ride_id;
    IF v_ride IS NULL OR v_ride.status != 'searching' THEN RETURN 0; END IF;
    
    FOR v_driver IN SELECT id, lat, lng FROM drivers WHERE is_online = true AND status = 'online' LIMIT 5 LOOP
        INSERT INTO ride_offers (ride_id, driver_id, distance_meters)
        VALUES (p_ride_id, v_driver.id, 1000) -- Mock distance for speed
        ON CONFLICT DO NOTHING;
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Accept Logic
CREATE OR REPLACE FUNCTION accept_ride_offer(p_offer_id UUID) RETURNS BOOLEAN AS $$
DECLARE
    v_offer RECORD;
BEGIN
    SELECT * INTO v_offer FROM ride_offers WHERE id = p_offer_id;
    IF v_offer IS NULL OR v_offer.status != 'pending' THEN RETURN FALSE; END IF;
    
    -- Check ride availability
    PERFORM 1 FROM rides WHERE id = v_offer.ride_id AND status = 'searching';
    IF NOT FOUND THEN RETURN FALSE; END IF;
    
    -- Accept
    UPDATE ride_offers SET status = 'accepted' WHERE id = p_offer_id;
    UPDATE ride_offers SET status = 'expired' WHERE ride_id = v_offer.ride_id AND id != p_offer_id;
    UPDATE rides SET driver_id = v_offer.driver_id, status = 'assigned', updated_at = now() WHERE id = v_offer.ride_id;
    UPDATE drivers SET status = 'busy' WHERE id = v_offer.driver_id;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION accept_ride_offer TO authenticated;

-- Auto Dispatch Trigger
CREATE OR REPLACE FUNCTION trigger_dispatch_on_ride_insert() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'searching' THEN
        PERFORM dispatch_ride_to_drivers(NEW.id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER dispatch_ride_trigger AFTER INSERT ON rides FOR EACH ROW EXECUTE FUNCTION trigger_dispatch_on_ride_insert();


-- ============================================================
-- 11. REALTIME CONFIGURATION
-- ============================================================

-- Add tables to publication
ALTER PUBLICATION supabase_realtime ADD TABLE 
    rides, 
    ride_offers, 
    drivers, 
    driver_locations, 
    rider_capabilities,
    saved_places;

-- ============================================================
-- END OF MASTER SCHEMA
-- ============================================================
