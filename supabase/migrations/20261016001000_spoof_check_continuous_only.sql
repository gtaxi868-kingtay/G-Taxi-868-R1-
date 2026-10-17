-- ═══════════════════════════════════════════════════════════════════
-- GPS-spoof check: compare only against a point from continuous tracking.
--
-- Found live right after 20261016000000: the speed check compared a new
-- ping against the driver's last point up to 30 minutes old. A driver who
-- goes offline, drives 40 km home and comes back online "moved" faster than
-- 110 km/h and got a spoof strike (3 strikes = suspended). Same rule as the
-- old edge function, but a real false-positive risk. Now the check only
-- applies when the last point is under 5 minutes old (the app pings every
-- 5-20 s while online); a longer gap means the driver was offline.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.driver_location_ping(
  p_lat double precision,
  p_lng double precision,
  p_heading double precision DEFAULT 0,
  p_speed double precision DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_claims text;
  v_driver record;
  v_last record;
  v_dt double precision;
  v_dist double precision;
  v_kmh double precision;
  v_ride record;
  v_now timestamptz := clock_timestamp();
  v_write_snapshot boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing or invalid lat/lng');
  END IF;

  SELECT d.id, d.spoof_suspended, d.last_seen, d.active_ride_id
    INTO v_driver
    FROM public.drivers d WHERE d.user_id = v_uid;
  IF v_driver.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a registered driver');
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND COALESCE(p.platform_blocked, false)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Account blocked. Contact support.');
  END IF;
  IF v_driver.spoof_suspended THEN
    RETURN jsonb_build_object('success', false, 'error', 'Account suspended pending review');
  END IF;

  IF NOT public.check_rate_limit(v_uid, 'update_driver_location', 60, 60) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many location updates');
  END IF;

  SELECT lat, lng, created_at INTO v_last
    FROM public.driver_locations
   WHERE driver_id = v_driver.id
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_last.created_at IS NOT NULL THEN
    v_dt := GREATEST(EXTRACT(EPOCH FROM (v_now - v_last.created_at)), 1);
    v_dist := 6371000 * 2 * asin(sqrt(
      sin(radians(p_lat - v_last.lat) / 2) ^ 2 +
      cos(radians(v_last.lat)) * cos(radians(p_lat)) *
      sin(radians(p_lng - v_last.lng) / 2) ^ 2));
    v_kmh := (v_dist / 1000) / (v_dt / 3600);

    IF v_dt > 1 AND v_kmh > 110 AND v_dt <= 300 THEN
      INSERT INTO public.gps_spoof_log (driver_id, reported_lat, reported_lng, last_known_lat, last_known_lng,
                                        implied_speed_kmh, time_delta_seconds, distance_meters, rejection_reason)
      VALUES (v_driver.id, p_lat, p_lng, v_last.lat, v_last.lng, v_kmh, v_dt, v_dist, 'velocity_threshold_exceeded');
      -- increment_spoof_flag changes protected driver columns, which only
      -- server code may do (as the edge function did with its service key).
      v_claims := current_setting('request.jwt.claims', true);
      PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
      PERFORM public.increment_spoof_flag(v_driver.id);
      PERFORM set_config('request.jwt.claims', COALESCE(v_claims, ''), true);
      RETURN jsonb_build_object('success', false, 'error', 'Movement too fast. Update rejected.');
    END IF;

    SELECT id, dropoff_lat, dropoff_lng INTO v_ride
      FROM public.rides
     WHERE driver_id = v_driver.id AND status = 'in_progress'
     LIMIT 1;
    IF v_ride.id IS NOT NULL AND v_ride.dropoff_lat IS NOT NULL THEN
      IF (6371000 * 2 * asin(sqrt(
            sin(radians(v_ride.dropoff_lat - p_lat) / 2) ^ 2 +
            cos(radians(p_lat)) * cos(radians(v_ride.dropoff_lat)) *
            sin(radians(v_ride.dropoff_lng - p_lng) / 2) ^ 2)))
         >
         (6371000 * 2 * asin(sqrt(
            sin(radians(v_ride.dropoff_lat - v_last.lat) / 2) ^ 2 +
            cos(radians(v_last.lat)) * cos(radians(v_ride.dropoff_lat)) *
            sin(radians(v_ride.dropoff_lng - v_last.lng) / 2) ^ 2))) + 500 THEN
        INSERT INTO public.ride_events (ride_id, event_type, actor_type, metadata)
        VALUES (v_ride.id, 'safety_detour_detected', 'system',
                jsonb_build_object('lat', p_lat, 'lng', p_lng));
      END IF;
    END IF;
  END IF;

  INSERT INTO public.driver_locations (driver_id, lat, lng, heading, speed)
  VALUES (v_driver.id, p_lat, p_lng, p_heading, p_speed);

  v_write_snapshot := v_driver.active_ride_id IS NOT NULL
                      OR v_driver.last_seen IS NULL
                      OR v_now - v_driver.last_seen >= interval '15 seconds'
                      OR EXISTS (SELECT 1 FROM public.rides r
                                  WHERE r.driver_id = v_driver.id
                                    AND r.status IN ('assigned', 'arrived', 'in_progress'));
  IF v_write_snapshot THEN
    UPDATE public.drivers
       SET lat = p_lat, lng = p_lng, heading = p_heading,
           is_online = true, last_seen = v_now
     WHERE id = v_driver.id;
  END IF;

  RETURN jsonb_build_object('success', true, 'snapshot', v_write_snapshot);
END;
$function$;

