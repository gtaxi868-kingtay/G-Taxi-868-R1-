-- 016_core_schema_hardening.sql
-- Implements P0 fixes from Completeness Audit

-- ============================================
-- 1. RIDER CAPABILITIES (CORE FEATURE TOGGLES)
-- ============================================
-- Note: Future service toggles (bidding, charter, fleet, maxi) are deferred

CREATE TABLE IF NOT EXISTS public.rider_capabilities (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    can_request_ride BOOLEAN DEFAULT true,
    can_use_cash BOOLEAN DEFAULT true,
    can_use_card BOOLEAN DEFAULT true,
    account_status TEXT DEFAULT 'active' CHECK (account_status IN ('active', 'suspended', 'blocked')),
    suspension_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.rider_capabilities ENABLE ROW LEVEL SECURITY;

-- Drop existing policies (for re-runs)
DROP POLICY IF EXISTS "Users can view own capabilities" ON public.rider_capabilities;
DROP POLICY IF EXISTS "Service role full access on rider_capabilities" ON public.rider_capabilities;

-- RLS: Users can view their own capabilities
CREATE POLICY "Users can view own capabilities" 
ON public.rider_capabilities 
FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

-- RLS: Service role can manage all
CREATE POLICY "Service role full access on rider_capabilities" 
ON public.rider_capabilities 
FOR ALL 
TO service_role 
USING (true) 
WITH CHECK (true);

-- Auto-create capabilities for new users
CREATE OR REPLACE FUNCTION public.handle_new_user_capabilities()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.rider_capabilities (user_id) 
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created_capabilities
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_capabilities();

-- Backfill existing users
INSERT INTO public.rider_capabilities (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- ============================================
-- 2. RIDE EVENTS (AUDIT TRAIL)
-- ============================================

CREATE TABLE IF NOT EXISTS public.ride_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID REFERENCES public.rides(id) ON DELETE CASCADE NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'created', 'searching', 'assigned', 'driver_arrived', 
        'trip_started', 'completed', 'cancelled', 'timeout'
    )),
    actor_type TEXT CHECK (actor_type IN ('rider', 'driver', 'system')),
    actor_id UUID,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ride_events_ride_id ON public.ride_events(ride_id);
CREATE INDEX IF NOT EXISTS idx_ride_events_created_at ON public.ride_events(created_at);

ALTER TABLE public.ride_events ENABLE ROW LEVEL SECURITY;

-- Drop existing policies (for re-runs)
DROP POLICY IF EXISTS "Users can view own ride events" ON public.ride_events;
DROP POLICY IF EXISTS "Service role full access on ride_events" ON public.ride_events;

-- RLS: Users can view events for their rides
CREATE POLICY "Users can view own ride events" 
ON public.ride_events 
FOR SELECT 
TO authenticated 
USING (
    EXISTS (
        SELECT 1 FROM public.rides 
        WHERE rides.id = ride_events.ride_id 
        AND rides.rider_id = auth.uid()
    )
);

-- RLS: Service role can insert events
CREATE POLICY "Service role full access on ride_events" 
ON public.ride_events 
FOR ALL 
TO service_role 
USING (true) 
WITH CHECK (true);

-- ============================================
-- 3. ADD VEHICLE_ID TO RIDES
-- ============================================

ALTER TABLE public.rides 
ADD COLUMN IF NOT EXISTS vehicle_id UUID;

-- Note: We don't have a vehicles table yet, so no FK constraint
-- When vehicles table is created, add: REFERENCES public.vehicles(id)

-- ============================================
-- 4. UPDATE RIDES STATUS TO INCLUDE 'BLOCKED' AND 'ARRIVED'
-- ============================================
-- Current: 'requested', 'searching', 'assigned', 'in_progress', 'completed', 'cancelled'
-- Adding: 'arrived', 'blocked'

-- Drop and recreate the check constraint
ALTER TABLE public.rides 
DROP CONSTRAINT IF EXISTS rides_status_check;

ALTER TABLE public.rides 
ADD CONSTRAINT rides_status_check 
CHECK (status IN (
    'requested', 
    'searching', 
    'assigned', 
    'arrived',      -- NEW: Driver at pickup
    'in_progress', 
    'completed', 
    'cancelled',
    'blocked'       -- NEW: Ride blocked by system
));

-- ============================================
-- 5. ADD RIDE NOTES FIELD
-- ============================================

ALTER TABLE public.rides 
ADD COLUMN IF NOT EXISTS notes TEXT;

-- ============================================
-- 6. ADD CANCELLATION TRACKING
-- ============================================

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS cancellation_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS issue_count INTEGER DEFAULT 0;

-- ============================================
-- 7. ENABLE REALTIME FOR NEW TABLES
-- ============================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND tablename = 'rider_capabilities'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE rider_capabilities;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND tablename = 'ride_events'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE ride_events;
    END IF;
END $$;
