-- Create ride_stops table
CREATE TABLE IF NOT EXISTS ride_stops (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    stop_order integer NOT NULL,
    place_name text NOT NULL,
    place_address text,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    stop_type text DEFAULT 'custom',
    estimated_wait_minutes integer DEFAULT 10,
    actual_wait_minutes integer,
    arrived_at timestamptz,
    departed_at timestamptz,
    stop_convenience_fee_cents integer DEFAULT 500,
    wait_fee_cents integer DEFAULT 0,
    status text DEFAULT 'pending',
    created_at timestamptz DEFAULT now()
);

-- Create stop_suggestions table
CREATE TABLE IF NOT EXISTS stop_suggestions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id uuid NOT NULL,
    ride_id uuid REFERENCES rides(id),
    suggested_place_name text,
    suggested_place_type text,
    suggested_lat double precision,
    suggested_lng double precision,
    was_accepted boolean DEFAULT false,
    suggestion_rank integer,
    created_at timestamptz DEFAULT now()
);

-- Create rider_stop_preferences table
CREATE TABLE IF NOT EXISTS rider_stop_preferences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id uuid NOT NULL,
    place_name text NOT NULL,
    place_type text,
    place_lat double precision,
    place_lng double precision,
    visit_count integer DEFAULT 1,
    last_visited timestamptz DEFAULT now(),
    avg_wait_minutes integer DEFAULT 10,
    UNIQUE(rider_id, place_name)
);

-- Create user_events table for AI learning
CREATE TABLE IF NOT EXISTS user_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    event_type text NOT NULL,
    ride_id uuid REFERENCES rides(id),
    metadata jsonb DEFAULT '{}',
    created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE ride_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE stop_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rider_stop_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Riders see own stops" ON ride_stops;
CREATE POLICY "Riders see own stops" ON ride_stops
    FOR SELECT USING (
        ride_id IN (SELECT id FROM rides WHERE rider_id = auth.uid())
    );

DROP POLICY IF EXISTS "Riders insert own stops" ON ride_stops;
CREATE POLICY "Riders insert own stops" ON ride_stops
    FOR INSERT WITH CHECK (
        ride_id IN (SELECT id FROM rides WHERE rider_id = auth.uid())
    );

DROP POLICY IF EXISTS "Riders see own preferences" ON rider_stop_preferences;
CREATE POLICY "Riders see own preferences" ON rider_stop_preferences
    FOR ALL USING (rider_id = auth.uid());

DROP POLICY IF EXISTS "Riders see own suggestions" ON stop_suggestions;
CREATE POLICY "Riders see own suggestions" ON stop_suggestions
    FOR SELECT USING (rider_id = auth.uid());

DROP POLICY IF EXISTS "Users see own events" ON user_events;
CREATE POLICY "Users see own events" ON user_events
    FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users insert own events" ON user_events;
CREATE POLICY "Users insert own events" ON user_events
    FOR INSERT WITH CHECK (user_id = auth.uid());

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ride_stops_ride_id ON ride_stops(ride_id);
CREATE INDEX IF NOT EXISTS idx_stop_suggestions_rider_id ON stop_suggestions(rider_id);
CREATE INDEX IF NOT EXISTS idx_rider_stop_preferences_rider_id ON rider_stop_preferences(rider_id);
CREATE INDEX IF NOT EXISTS idx_user_events_user_id ON user_events(user_id);
CREATE INDEX IF NOT EXISTS idx_user_events_created_at ON user_events(created_at);
