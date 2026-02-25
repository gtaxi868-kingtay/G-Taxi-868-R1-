-- G-Taxi Database Schema (Corrected per Supabase AI Agent review)
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/kdatihgcxrosuwcqtjsi/sql

-- ============================================
-- PROFILES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Allow users to view and update their own profile
-- Allow users to view and update their own profile
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_policies 
        WHERE tablename = 'profiles' 
        AND policyname = 'Users can view own profile'
    ) THEN
        CREATE POLICY "Users can view own profile" ON profiles
          FOR SELECT USING ((SELECT auth.uid()) = id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 
        FROM pg_policies 
        WHERE tablename = 'profiles' 
        AND policyname = 'Users can update own profile'
    ) THEN
        CREATE POLICY "Users can update own profile" ON profiles
          FOR UPDATE USING ((SELECT auth.uid()) = id)
          WITH CHECK ((SELECT auth.uid()) = id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 
        FROM pg_policies 
        WHERE tablename = 'profiles' 
        AND policyname = 'Users can insert own profile'
    ) THEN
        CREATE POLICY "Users can insert own profile" ON profiles
          FOR INSERT WITH CHECK ((SELECT auth.uid()) = id);
    END IF;
END $$;

-- Trigger to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Revoke execute from public so only owner can run it
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;


-- ============================================
-- RIDES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id UUID REFERENCES auth.users(id),
  pickup_lat NUMERIC NOT NULL,
  pickup_lng NUMERIC NOT NULL,
  pickup_address TEXT,
  dropoff_lat NUMERIC NOT NULL,
  dropoff_lng NUMERIC NOT NULL,
  dropoff_address TEXT,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'searching', 'assigned', 'in_progress', 'completed', 'cancelled')),
  total_fare_cents BIGINT,
  distance_meters INTEGER,
  duration_seconds INTEGER,
  route_polyline TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE rides ENABLE ROW LEVEL SECURITY;

-- Riders can read their own rides
-- Riders can read their own rides
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_policies 
        WHERE tablename = 'rides' 
        AND policyname = 'Riders can view own rides'
    ) THEN
        CREATE POLICY "Riders can view own rides" ON rides
          FOR SELECT USING ((SELECT auth.uid()) = rider_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 
        FROM pg_policies 
        WHERE tablename = 'rides' 
        AND policyname = 'Riders can insert own rides'
    ) THEN
        CREATE POLICY "Riders can insert own rides" ON rides
          FOR INSERT WITH CHECK ((SELECT auth.uid()) = rider_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 
        FROM pg_policies 
        WHERE tablename = 'rides' 
        AND policyname = 'Riders can update own rides'
    ) THEN
        CREATE POLICY "Riders can update own rides" ON rides
          FOR UPDATE
          USING ((SELECT auth.uid()) = rider_id)
          WITH CHECK ((SELECT auth.uid()) = rider_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 
        FROM pg_policies 
        WHERE tablename = 'rides' 
        AND policyname = 'No client deletes'
    ) THEN
        CREATE POLICY "No client deletes" ON rides
          FOR DELETE TO authenticated USING (false);
    END IF;
END $$;

-- ============================================
-- UBER-STANDARD: ONE ACTIVE RIDE PER RIDER
-- This unique index prevents duplicate ride requests
-- ============================================
CREATE UNIQUE INDEX IF NOT EXISTS one_active_ride_per_rider
ON rides (rider_id)
WHERE status IN ('requested', 'searching', 'assigned', 'in_progress');

-- ============================================
-- UPDATE TIMESTAMP TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER rides_updated_at
  BEFORE UPDATE ON rides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- ENABLE REALTIME
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'rides'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE rides;
    END IF;
END $$;
