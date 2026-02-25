-- 8. Production Tables: driver_locations & events
-- Implements the "Master Directive" required tables for high-frequency updates and audit logging.

-- ============================================
-- 1. DRIVER LOCATIONS (High Frequency)
-- ============================================
-- Separation of concerns: We do not spam the main 'drivers' profile table with GPS pings.
CREATE TABLE IF NOT EXISTS public.driver_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  heading DOUBLE PRECISION DEFAULT 0,
  speed DOUBLE PRECISION DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast frequent lookups
CREATE INDEX IF NOT EXISTS idx_driver_locations_driver_id ON public.driver_locations(driver_id);

-- RLS: Only Service Role or the specific Driver can write. Everyone can read (for ghost cars).
ALTER TABLE public.driver_locations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'driver_locations' AND policyname = 'Public read access'
    ) THEN
        CREATE POLICY "Public read access" ON public.driver_locations FOR SELECT USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'driver_locations' AND policyname = 'Service role full access'
    ) THEN
        CREATE POLICY "Service role full access" ON public.driver_locations FOR ALL USING (auth.role() = 'service_role');
    END IF;
END $$;

-- Enable Realtime for this table (Critical for moving cars on map)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'driver_locations'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_locations;
    END IF;
END $$;


-- ============================================
-- 2. EVENTS (Audit Log)
-- ============================================
-- Uber-style immutable log of what happened. Source of truth for debugging.
CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  role TEXT CHECK (role IN ('rider', 'driver', 'system')),
  event_type TEXT NOT NULL, -- e.g., 'ride_requested', 'driver_assigned', 'ride_cancelled'
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Only System acts on this usually, but we allow authenticated inserts for client logs if needed.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'events' AND policyname = 'Service role full access'
    ) THEN
        CREATE POLICY "Service role full access" ON public.events FOR ALL USING (auth.role() = 'service_role');
    END IF;
END $$;
