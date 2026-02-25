-- 1. ENUMS (Safe Creation & Update)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ride_status') THEN
        CREATE TYPE public.ride_status AS ENUM (
            'requested', 'searching', 'assigned', 'arrived', 
            'in_progress', 'completed', 'cancelled', 'scheduled', 'blocked', 'expired'
        );
    ELSE
        -- Ensure 'expired' exists
        BEGIN
            ALTER TYPE public.ride_status ADD VALUE 'expired';
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END;
    END IF;
END $$;

-- 1. CLEANUP CONSTRAINTS & STATE ENGINE
-- We drop these to allow virtual/bot actors to coexist and fix the Hard Lock.
ALTER TABLE IF EXISTS public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
ALTER TABLE IF EXISTS public.drivers DROP CONSTRAINT IF EXISTS drivers_id_fkey;
ALTER TABLE IF EXISTS public.drivers DROP CONSTRAINT IF EXISTS drivers_user_id_fkey;
ALTER TABLE IF EXISTS public.rides DROP CONSTRAINT IF EXISTS rides_rider_id_fkey;

-- Fix the State Machine Transition Matrix (Uber-style)
CREATE OR REPLACE FUNCTION validate_ride_status_transition()
RETURNS TRIGGER AS $$
DECLARE
    old_status text := OLD.status::text;
    new_status text := NEW.status::text;
BEGIN
    if old_status = new_status THEN RETURN NEW; END IF;
    
    -- Allowed Transitions
    IF new_status IN ('cancelled', 'expired') THEN RETURN NEW; END IF; -- Terminal states are always allowed
    IF old_status = 'requested' AND new_status = 'searching' THEN RETURN NEW; END IF;
    IF old_status = 'searching' AND new_status = 'assigned' THEN RETURN NEW; END IF;
    IF old_status = 'assigned' AND new_status = 'arrived' THEN RETURN NEW; END IF;
    IF old_status = 'arrived' AND new_status = 'in_progress' THEN RETURN NEW; END IF;
    IF old_status = 'in_progress' AND new_status = 'completed' THEN RETURN NEW; END IF;

    RAISE EXCEPTION 'Invalid Ride Status Transition: % -> %', old_status, new_status;
END;
$$ LANGUAGE plpgsql;

-- Re-attach trigger
DROP TRIGGER IF EXISTS trg_validate_ride_status ON public.rides;
CREATE TRIGGER trg_validate_ride_status
    BEFORE UPDATE OF status ON public.rides
    FOR EACH ROW
    EXECUTE FUNCTION validate_ride_status_transition();

-- 2. CORE TABLES (SELF-HEALING)

-- PROFILES
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY,
    user_id UUID, 
    email TEXT,
    full_name TEXT,
    phone_number TEXT,
    avatar_url TEXT,
    is_admin BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- DRIVERS
CREATE TABLE IF NOT EXISTS public.drivers (
    id UUID PRIMARY KEY,
    user_id UUID,
    name TEXT NOT NULL,
    vehicle_model TEXT,
    plate_number TEXT,
    status TEXT DEFAULT 'offline',
    is_online BOOLEAN DEFAULT false,
    is_bot BOOLEAN DEFAULT false,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    location GEOGRAPHY(POINT, 4326),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Ensure columns exist (if table was created by an old migration)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS is_bot BOOLEAN DEFAULT false;

-- RIDES (Handling "ON DELETE SET NULL" to prevent history crashes)
CREATE TABLE IF NOT EXISTS public.rides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL,
    driver_id UUID,
    pickup_lat DOUBLE PRECISION NOT NULL,
    pickup_lng DOUBLE PRECISION NOT NULL,
    pickup_address TEXT,
    dropoff_lat DOUBLE PRECISION NOT NULL,
    dropoff_lng DOUBLE PRECISION NOT NULL,
    dropoff_address TEXT,
    status TEXT DEFAULT 'searching',
    total_fare_cents INTEGER,
    tip_amount INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- If rides table exists, ensure the foreign key is graceful
ALTER TABLE public.rides DROP CONSTRAINT IF EXISTS rides_driver_id_fkey;
ALTER TABLE public.rides ADD CONSTRAINT rides_driver_id_fkey 
    FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE SET NULL;

-- SAVED PLACES (The Uber locations engine)
CREATE TABLE IF NOT EXISTS public.saved_places (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    label TEXT NOT NULL, -- e.g. 'Home', 'Work', 'Gym'
    address TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    icon TEXT, -- emoji or icon name
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Ensure indexes for fast search
CREATE INDEX IF NOT EXISTS idx_saved_places_user_id ON public.saved_places(user_id);

-- 3. LOGIC (RPCs)

CREATE OR REPLACE FUNCTION public.get_wallet_balance(p_user_id UUID) RETURNS INTEGER AS $$
    SELECT COALESCE(SUM(amount), 0) FROM public.wallet_transactions 
    WHERE user_id = p_user_id AND status = 'completed';
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.expire_ride(p_ride_id UUID) RETURNS JSONB AS $$
DECLARE
    v_status TEXT;
BEGIN
    SELECT status INTO v_status FROM public.rides WHERE id = p_ride_id;
    IF v_status IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Ride not found'); END IF;
    IF v_status NOT IN ('requested', 'searching') THEN RETURN jsonb_build_object('success', false, 'error', 'Ride is already assigned or terminal'); END IF;

    UPDATE public.rides SET status = 'expired', updated_at = NOW() WHERE id = p_ride_id;
    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. SEED BOT DRIVERS (Idempotent - No Deletion)
-- We "UPSERT" so we don't break existing rides referencing these IDs.
INSERT INTO public.drivers (id, name, lat, lng, vehicle_model, plate_number, status, is_online, is_bot)
VALUES 
    ('8b234089-4a6a-4db9-a933-550be843ab74', 'Ricardo (Bot)', 10.65, -61.51, 'Toyota Corolla', 'PDC 1234', 'online', true, true),
    ('9c345190-5b7b-5ec0-b044-661cf954bc85', 'Sarita (Bot)', 10.28, -61.45, 'Hyundai Elantra', 'PDS 5678', 'online', true, true)
ON CONFLICT (id) DO UPDATE SET 
    status = EXCLUDED.status,
    is_online = EXCLUDED.is_online,
    lat = EXCLUDED.lat,
    lng = EXCLUDED.lng;

-- 5. PERMISSIONS
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- 6. REALTIME
DO $$ 
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.rides, public.drivers;
    EXCEPTION WHEN OTHERS THEN 
        RAISE NOTICE 'Realtime publication already configured';
    END;
END $$;

COMMIT;
NOTIFY pgrst, 'reload schema';
