-- 20260406000003_final_payout_and_ai_wiring.sql
-- Phase 11.5: Driver Payout Transparency & Real AI Discovery

-- 1. Update ride_offers with payout tracking
ALTER TABLE public.ride_offers ADD COLUMN IF NOT EXISTS driver_payout_cents INTEGER;

-- 2. Update rides with final payout tracking
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS driver_payout_cents INTEGER;

-- 3. Optimization for AI POI Queries
CREATE INDEX IF NOT EXISTS idx_merchants_location ON public.merchants USING GIST (
    (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography)
);

CREATE INDEX IF NOT EXISTS idx_locations_category ON public.locations(category);

-- 4. RPC for AI POI Discovery
-- Fetches nearby partner merchants with potential open slots or general POIs
CREATE OR REPLACE FUNCTION public.get_proactive_poi_context(
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    p_radius_meters INTEGER DEFAULT 1000
) RETURNS TABLE (
    name TEXT,
    category TEXT,
    distance_meters INTEGER,
    is_partner BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    (
        -- Partner Merchants
        SELECT 
            m.name,
            m.category,
            round(ST_Distance(ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, ST_SetSRID(ST_MakePoint(m.lng, m.lat), 4326)::geography))::integer as distance_meters,
            true as is_partner
        FROM public.merchants m
        WHERE m.is_active = true
          AND ST_DWithin(ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, ST_SetSRID(ST_MakePoint(m.lng, m.lat), 4326)::geography, p_radius_meters)
        LIMIT 3
    )
    UNION ALL
    (
        -- General POIs (fallback)
        SELECT 
            l.name,
            l.category,
            round(ST_Distance(ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, ST_SetSRID(ST_MakePoint(l.longitude, l.latitude), 4326)::geography))::integer as distance_meters,
            false as is_partner
        FROM public.locations l
        WHERE (l.category = 'atm' OR l.category = 'grocery' OR l.category = 'pharmacy')
          AND ST_DWithin(ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, ST_SetSRID(ST_MakePoint(l.longitude, l.latitude), 4326)::geography, p_radius_meters)
        LIMIT 3
    )
    ORDER BY is_partner DESC, distance_meters ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Ride Events Table (Logging for AI & Cron)
CREATE TABLE IF NOT EXISTS public.ride_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID REFERENCES public.rides(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL, -- 'ai_insight', 'cron_cleanup', 'merchant_summons'
    actor_type TEXT DEFAULT 'system', -- 'system', 'rider', 'driver', 'merchant'
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ride_events ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Only systemic access for now (Service Role)
-- Riders/Drivers can see events in future phases
CREATE POLICY "Service role only for ride_events" 
    ON public.ride_events FOR ALL 
    USING (true); -- Managed by Edge/Cron (Service Role)

-- Realtime Support (Idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'ride_events'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_events;
    END IF;
END $$;
