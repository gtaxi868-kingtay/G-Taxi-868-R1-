-- Migration: demand_prediction
-- Phase 4 Fix: AI demand prediction for proactive driver positioning
-- Market evidence: Uber Michelangelo does 10M predictions/sec, reduces wait times 30-40%

-- 1. Create demand patterns table for ML training
CREATE TABLE IF NOT EXISTS demand_patterns (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    area_hash TEXT NOT NULL, -- geohash of ~500m area
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    hour_of_day INTEGER NOT NULL CHECK (hour_of_day BETWEEN 0 AND 23),
    weather_condition TEXT DEFAULT 'clear',
    is_holiday BOOLEAN DEFAULT false,
    predicted_demand INTEGER DEFAULT 0, -- expected ride requests
    actual_demand INTEGER DEFAULT 0, -- actual requests (for ML training)
    active_drivers INTEGER DEFAULT 0, -- drivers online at time
    demand_score NUMERIC(4,2) DEFAULT 1.0, -- demand/supply ratio
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Enable RLS
ALTER TABLE demand_patterns ENABLE ROW LEVEL SECURITY;

-- 3. RLS: Create policy with existence check
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'demand_patterns' 
        AND policyname = 'Allow drivers to read demand patterns'
    ) THEN
        CREATE POLICY "Allow drivers to read demand patterns"
        ON demand_patterns FOR SELECT
        TO authenticated
        USING (true);
    END IF;
END $$;

-- 4. Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_demand_lookup 
ON demand_patterns(area_hash, day_of_week, hour_of_day, weather_condition);

CREATE INDEX IF NOT EXISTS idx_demand_time 
ON demand_patterns(day_of_week, hour_of_day) 
WHERE demand_score > 1.5;

CREATE INDEX IF NOT EXISTS idx_demand_high 
ON demand_patterns(area_hash, demand_score DESC) 
WHERE demand_score > 1.5;

-- 5. Create function to get current demand prediction
CREATE OR REPLACE FUNCTION get_demand_prediction(
    p_lat NUMERIC,
    p_lng NUMERIC,
    p_radius_meters INTEGER DEFAULT 3000
) RETURNS TABLE (
    area_hash TEXT,
    predicted_demand INTEGER,
    active_drivers INTEGER,
    demand_score NUMERIC,
    recommendation TEXT,
    confidence NUMERIC
) AS $$
DECLARE
    v_day INTEGER;
    v_hour INTEGER;
    v_target_hash TEXT;
BEGIN
    v_day := EXTRACT(DOW FROM NOW());
    v_hour := EXTRACT(HOUR FROM NOW());
    v_target_hash := substr(encode(digest(concat(p_lat::text, ',', p_lng::text), 'sha256'), 'hex'), 1, 8);
    
    RETURN QUERY
    WITH nearby_areas AS (
        SELECT 
            dp.area_hash,
            avg(dp.predicted_demand)::INTEGER as avg_predicted,
            avg(dp.actual_demand)::INTEGER as avg_actual,
            avg(dp.active_drivers)::INTEGER as avg_drivers,
            avg(dp.demand_score)::NUMERIC(4,2) as avg_score,
            count(*) as sample_count
        FROM demand_patterns dp
        WHERE dp.day_of_week = v_day
          AND dp.hour_of_day = v_hour
          AND dp.area_hash LIKE substr(v_target_hash, 1, 4) || '%'
          AND dp.created_at > NOW() - INTERVAL '28 days'
        GROUP BY dp.area_hash
    )
    SELECT 
        na.area_hash,
        na.avg_predicted as predicted_demand,
        na.avg_drivers as active_drivers,
        na.avg_score as demand_score,
        CASE 
            WHEN na.avg_score > 2.0 THEN 'HIGH_DEMAND_POSITION_HERE'
            WHEN na.avg_score > 1.5 THEN 'ELEVATED_DEMAND_GOOD_OPPORTUNITY'
            WHEN na.avg_score < 0.5 THEN 'LOW_DEMAND_CONSIDER_MOVING'
            ELSE 'NORMAL_DEMAND'
        END::TEXT as recommendation,
        least(na.sample_count / 4.0, 1.0)::NUMERIC as confidence
    FROM nearby_areas na
    ORDER BY na.avg_score DESC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Create function to log actual demand (called on ride creation)
CREATE OR REPLACE FUNCTION log_demand_request(
    p_pickup_lat NUMERIC,
    p_pickup_lng NUMERIC,
    p_weather TEXT DEFAULT 'clear'
) RETURNS VOID AS $$
DECLARE
    v_hash TEXT;
    v_day INTEGER;
    v_hour INTEGER;
    v_drivers INTEGER;
BEGIN
    -- Create area hash (simplified geohash)
    v_hash := substr(concat(
        to_char(floor(p_pickup_lat * 100)::INTEGER, 'FM0000'),
        to_char(floor(abs(p_pickup_lng) * 100)::INTEGER, 'FM0000')
    ), 1, 8);
    
    v_day := EXTRACT(DOW FROM NOW());
    v_hour := EXTRACT(HOUR FROM NOW());
    
    -- Count active drivers in area
    SELECT COUNT(*) INTO v_drivers
    FROM drivers
    WHERE is_online = true 
      AND is_available = true
      AND last_lat IS NOT NULL
      AND last_lng IS NOT NULL
      AND (point(p_pickup_lng, p_pickup_lat) <-> point(last_lng, last_lat)) < 0.03; -- ~3km
    
    -- Insert or update demand record
    INSERT INTO demand_patterns (
        area_hash, day_of_week, hour_of_day, weather_condition, 
        actual_demand, active_drivers, demand_score
    ) VALUES (
        v_hash, v_day, v_hour, p_weather,
        1, v_drivers, 
        CASE WHEN v_drivers > 0 THEN 1.0 / v_drivers ELSE 1.0 END
    )
    ON CONFLICT (area_hash, day_of_week, hour_of_day, weather_condition) 
    DO UPDATE SET
        actual_demand = demand_patterns.actual_demand + 1,
        active_drivers = EXCLUDED.active_drivers,
        demand_score = (demand_patterns.actual_demand + 1)::NUMERIC / NULLIF(EXCLUDED.active_drivers, 0),
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Create trigger to auto-log demand on ride creation
CREATE OR REPLACE FUNCTION trigger_log_demand()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM log_demand_request(
        NEW.pickup_lat::NUMERIC,
        NEW.pickup_lng::NUMERIC
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only create trigger if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'auto_log_demand'
    ) THEN
        CREATE TRIGGER auto_log_demand
        AFTER INSERT ON rides
        FOR EACH ROW
        WHEN (NEW.status = 'requested')
        EXECUTE FUNCTION trigger_log_demand();
    END IF;
END $$;

-- 8. Create materialized view for hot zones (refresh every 15 min recommended)
CREATE MATERIALIZED VIEW IF NOT EXISTS hot_zones AS
SELECT 
    area_hash,
    avg(predicted_demand) as avg_predicted,
    avg(actual_demand) as avg_actual,
    avg(demand_score) as avg_score,
    day_of_week,
    hour_of_day,
    max(updated_at) as last_updated
FROM demand_patterns
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY area_hash, day_of_week, hour_of_day
HAVING avg(demand_score) > 1.5;

-- Create index on materialized view
CREATE INDEX IF NOT EXISTS idx_hot_zones_lookup 
ON hot_zones(day_of_week, hour_of_day, avg_score DESC);

-- Notify schema cache update
NOTIFY pgrst, 'reload schema';
