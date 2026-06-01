-- Phase 2: Optimized Marketplace Core
-- Drops legacy triggers, enables async dispatch via pg_net,
-- adds phantom columns, creates location packet RPC and retry function.

-- 1. Obliterate legacy matching infrastructure
DROP TRIGGER IF EXISTS dispatch_ride_trigger ON rides;
DROP FUNCTION IF EXISTS dispatch_ride_to_drivers;

-- 2. Add phantom columns that would crash at runtime
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS last_location_update TIMESTAMPTZ;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS active_ride_id UUID REFERENCES rides(id);

-- 3. Add updated_at trigger on drivers (missing, referenced by code)
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_drivers_updated_at ON drivers;
CREATE TRIGGER set_drivers_updated_at
  BEFORE UPDATE ON drivers
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- 4. Async dispatch trigger via pg_net (no polling, no infinite loops)
-- Fires match_driver edge function the millisecond a ride hits 'searching'
CREATE OR REPLACE FUNCTION dispatch_match_on_ride_insert()
RETURNS TRIGGER AS $func$
BEGIN
  PERFORM net.http_post(
    url := current_setting('supabase.url') || '/functions/v1/match_driver',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.anon_key')
    ),
    body := jsonb_build_object('ride_id', NEW.id)::text,
    timeout_milliseconds := 10000
  );
  RETURN NEW;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_match_on_insert ON rides;
CREATE TRIGGER trigger_match_on_insert
  AFTER INSERT ON rides
  FOR EACH ROW WHEN (NEW.status = 'searching')
  EXECUTE FUNCTION dispatch_match_on_ride_insert();

-- 5. Retry ride matching RPC (called from SearchingDriverScreen on decline)
CREATE OR REPLACE FUNCTION retry_ride_matching(p_ride_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  PERFORM net.http_post(
    url := current_setting('supabase.url') || '/functions/v1/match_driver',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.anon_key')
    ),
    body := jsonb_build_object('ride_id', p_ride_id)::text,
    timeout_milliseconds := 10000
  );
END;
$$;

-- 6. update_driver_location_packet RPC
-- SECURITY DEFINER so it can write; auth.uid() validates caller
-- Coords cast to PostGIS GEOGRAPHY for match_driver engine compatibility
CREATE OR REPLACE FUNCTION update_driver_location_packet(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_heading DOUBLE PRECISION DEFAULT NULL,
  p_speed DOUBLE PRECISION DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id UUID;
  v_prev_lat DOUBLE PRECISION;
  v_prev_lng DOUBLE PRECISION;
  v_timestamp TIMESTAMPTZ := NOW();
BEGIN
  v_driver_id := auth.uid();
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING HINT = 'Not authenticated';
  END IF;

  SELECT lat, lng INTO v_prev_lat, v_prev_lng
  FROM drivers WHERE id = v_driver_id;

  IF v_prev_lat IS NOT NULL AND v_prev_lng IS NOT NULL THEN
    PERFORM check_gps_spoof(
      p_driver_id := v_driver_id,
      p_new_lat := p_lat,
      p_new_lng := p_lng,
      p_prev_lat := v_prev_lat,
      p_prev_lng := v_prev_lng,
      p_timestamp := v_timestamp
    );
  END IF;

  INSERT INTO driver_locations(driver_id, lat, lng, heading, speed, created_at)
  VALUES (v_driver_id, p_lat, p_lng, p_heading, p_speed, v_timestamp);

  UPDATE drivers SET
    lat = p_lat,
    lng = p_lng,
    heading = COALESCE(p_heading, heading),
    location = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    last_seen = v_timestamp,
    last_location_update = v_timestamp,
    is_online = true,
    status = 'online'
  WHERE id = v_driver_id;
END;
$$;
