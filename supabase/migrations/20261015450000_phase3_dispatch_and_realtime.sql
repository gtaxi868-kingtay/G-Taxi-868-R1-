-- ═══════════════════════════════════════════════════════════════════
-- Phase 3 fixes (founder approved "fix phase 3", 2026-10-15).
--
-- F1  One active ride per rider. Two overlapping bookings (different
--     request keys) created two rides (PROVEN live): create_ride's
--     duplicate check is check-then-insert. A partial unique index makes the
--     database refuse the second one, however it arrives.
-- F4  Dispatch skipped "ghost" drivers never: a driver whose phone died
--     or who swiped the app away stayed is_online forever and kept being
--     offered jobs (20 s wasted per ghost). Both dispatch pickers now need
--     status 'online' and a sign of life in the last 5 minutes (last_seen,
--     written by update_driver_location and the 30 s app heartbeat), and a
--     sweep every 5 minutes switches drivers silent for 15+ minutes offline
--     (never one with an active ride).
-- F11 Live channels that could never deliver because their table was not
--     published: driver multi-stop (ride_stops), rider level-ups
--     (rider_progression), feature switches (system_feature_flags), Escape
--     trip screens (package_reservations, itinerary_legs,
--     master_escape_itineraries), admin Rescue (nfc_event_logs), merchant
--     web revenue (revenue_splits). Realtime still applies each table's RLS.
-- F13 Admin dashboard live ride updates never arrived: admins had no read
--     access to rides.
-- ═══════════════════════════════════════════════════════════════════

-- F1
CREATE UNIQUE INDEX IF NOT EXISTS rides_one_active_per_rider
  ON public.rides (rider_id)
  WHERE status IN ('requested', 'searching', 'waiting_queue', 'assigned', 'arrived', 'in_progress');

-- F4: pickers
CREATE OR REPLACE FUNCTION public.find_nearest_online_drivers(
  p_lat double precision,
  p_lng double precision,
  p_radius_meters double precision DEFAULT 3000,
  p_limit integer DEFAULT 1)
RETURNS TABLE(driver_id uuid, push_token text, distance_m double precision)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    d.id AS driver_id,
    d.push_token,
    ST_Distance(d.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) AS distance_m
  FROM drivers d
  WHERE d.is_online = true
    AND d.status = 'online'
    AND d.verified_status = 'approved'
    AND COALESCE(d.is_bot, false) = false
    AND d.active_ride_id IS NULL
    AND COALESCE(d.spoof_suspended, false) = false
    AND d.location IS NOT NULL
    AND GREATEST(d.last_seen, d.last_location_update) > now() - interval '5 minutes'
    AND ST_DWithin(d.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_radius_meters)
  ORDER BY distance_m ASC
  LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.claim_available_driver(p_pickup_lat double precision, p_pickup_lng double precision, p_vehicle_type text, p_rider_id uuid, p_max_distance_km double precision DEFAULT 15, p_candidate_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(driver_id uuid, driver_name text, distance_km double precision, composite_score double precision)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  WEIGHT_DISTANCE CONSTANT float := 0.70;
  WEIGHT_ACCEPT   CONSTANT float := 0.30;
  v_driver_id uuid;
  v_pickup_point geography := ST_SetSRID(ST_MakePoint(p_pickup_lng, p_pickup_lat), 4326)::geography;
BEGIN
  WITH candidates AS (
    SELECT
      d.id,
      ST_Distance(d.location, v_pickup_point) / 1000.0 AS dist_km,
      COALESCE(d.acceptance_rate, 0.80) AS acc
    FROM drivers d
    WHERE d.is_online = true
      AND d.status = 'online'
      AND d.is_verified = true
      AND d.active_ride_id IS NULL
      AND d.location IS NOT NULL
      -- a sign of life in the last 5 minutes (no ghost drivers)
      AND GREATEST(d.last_seen, d.last_location_update) > now() - interval '5 minutes'
      AND (
        (p_candidate_ids IS NOT NULL AND d.id = ANY(p_candidate_ids))
        OR (p_candidate_ids IS NULL AND ST_DWithin(d.location, v_pickup_point, p_max_distance_km * 1000))
      )
      AND (lower(p_vehicle_type) = 'any' OR lower(d.vehicle_type) = lower(p_vehicle_type))
      AND NOT EXISTS (
        SELECT 1 FROM blacklists b
        WHERE (b.user_id = p_rider_id AND b.blocked_user_id = d.user_id)
           OR (b.user_id = d.user_id AND b.blocked_user_id = p_rider_id)
      )
  )
  SELECT c.id INTO v_driver_id
  FROM candidates c
  ORDER BY (
    WEIGHT_DISTANCE * (1.0 - LEAST(c.dist_km / NULLIF(p_max_distance_km, 0), 1.0)) +
    WEIGHT_ACCEPT   * c.acc
  ) DESC
  LIMIT 1;

  IF v_driver_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM 1 FROM drivers WHERE id = v_driver_id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    d.id,
    d.name,
    ST_Distance(d.location, v_pickup_point) / 1000.0 AS distance_km,
    WEIGHT_DISTANCE * (1.0 - LEAST(
      (ST_Distance(d.location, v_pickup_point) / 1000.0) / NULLIF(p_max_distance_km, 0), 1.0)) +
    WEIGHT_ACCEPT * COALESCE(d.acceptance_rate, 0.80) AS composite_score
  FROM drivers d WHERE d.id = v_driver_id;
END;
$function$;

-- F4: sweep
CREATE OR REPLACE FUNCTION public.sweep_stale_online_drivers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  n integer;
BEGIN
  UPDATE public.drivers
     SET is_online = false, status = 'offline'
   WHERE is_online = true
     AND active_ride_id IS NULL
     AND COALESCE(GREATEST(last_seen, last_location_update), 'epoch'::timestamptz) < now() - interval '15 minutes';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;
REVOKE ALL ON FUNCTION public.sweep_stale_online_drivers() FROM PUBLIC, anon, authenticated;

DO $cron$
BEGIN
  PERFORM cron.unschedule('sweep-stale-online-drivers')
   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-stale-online-drivers');
  PERFORM cron.schedule('sweep-stale-online-drivers', '*/5 * * * *', 'SELECT public.sweep_stale_online_drivers()');
END
$cron$;

-- F11: publish the tables those screens listen to
DO $pub$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ride_stops', 'rider_progression', 'system_feature_flags', 'package_reservations',
                           'itinerary_legs', 'master_escape_itineraries', 'nfc_event_logs', 'revenue_splits'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END
$pub$;

-- F13
DROP POLICY IF EXISTS "Admins read all rides" ON public.rides;
CREATE POLICY "Admins read all rides" ON public.rides
  FOR SELECT TO authenticated USING (public.auth_is_admin());
