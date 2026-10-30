-- ═══════════════════════════════════════════════════════════════════
-- Wire the insurance gate (Day-One Readiness audit §4.3, closing item 2).
--
-- check_driver_insurance_compliance() has existed and been correct,
-- but NOTHING called it: the driver app's toggleOnline wrote
-- drivers.is_online directly after only a wallet-lockout check, every
-- GPS ping silently re-onlined the driver, and both dispatch candidate
-- queries (claim_available_driver, find_nearest_online_drivers) never
-- looked at insurance. All 4 live drivers are approved with
-- insurance_expires_at = NULL — an uninsured driver could take trips.
--
-- This migration wires the check into the deepest shared server
-- joints, mirroring the house pattern that already exists for debt
-- (trigger_enforce_debt -> enforce_driver_debt_limit, same shape):
--   1. trigger_enforce_insurance — BEFORE UPDATE OF is_online, any
--      write that onlines a driver first asks
--      check_driver_insurance_compliance; a non-compliant driver is
--      REFUSED with that function's own plain message ("No insurance
--      on file. Submit your certificate..." / "Your insurance expired
--      on ... Upload a new certificate..."). No grandfather bypass:
--      NULL insurance is non-compliant by design (pilot standard).
--      The way back in is the existing compliance_queue review flow —
--      approve_compliance_document writes insurance_expires_at, after
--      which this gate passes.
--   2. Dispatch: claim_available_driver (match_driver's claim) and
--      find_nearest_online_drivers (dispatch-queue re-offers, merchant
--      dispatch) both exclude insurance_expires_at NULL/past at offer
--      time.
--   3. The implicit re-online writers are made insurance-aware so a
--      ping can no longer resurrect a non-compliant driver and a
--      wallet topup can neither reactivate one nor be aborted by the
--      gate: driver_location_ping, update_driver_location_packet,
--      fn_auto_reactivate_driver.
--   4. driver_insurance_status() — an authenticated, own-row-only
--      wrapper so the driver app can pre-check and route the driver
--      to the compliance upload screen with the reason on screen.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. App-facing pre-check (own row only) ──────────────────────────
CREATE OR REPLACE FUNCTION public.driver_insurance_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_driver_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('compliant', false, 'error', 'Unauthorized');
  END IF;
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = v_uid;
  IF v_driver_id IS NULL THEN
    RETURN jsonb_build_object('compliant', false, 'error', 'Not a registered driver');
  END IF;
  RETURN public.check_driver_insurance_compliance(v_driver_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.driver_insurance_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_insurance_status() TO authenticated, service_role;

-- ── 2. The gate itself (mirror of trigger_enforce_debt) ────────────
CREATE OR REPLACE FUNCTION public.enforce_driver_insurance_compliance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_check jsonb;
BEGIN
  IF NEW.is_online = true THEN
    v_check := public.check_driver_insurance_compliance(NEW.id);
    IF NOT COALESCE((v_check ->> 'compliant')::boolean, false) THEN
      RAISE EXCEPTION '%', COALESCE(v_check ->> 'message',
        'Insurance not on file. Upload your insurance documents to go online.')
        USING HINT = COALESCE(v_check ->> 'blocked_reason', 'insurance_not_submitted');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_enforce_insurance ON public.drivers;
CREATE TRIGGER trigger_enforce_insurance
  BEFORE UPDATE OF is_online ON public.drivers
  FOR EACH ROW WHEN ((new.is_online = true))
  EXECUTE FUNCTION public.enforce_driver_insurance_compliance();

-- ── 3. fn_auto_reactivate_driver: topups never reactivate the uninsured ──
CREATE OR REPLACE FUNCTION public.fn_auto_reactivate_driver()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_balance INT;
BEGIN
    IF NEW.transaction_type = 'topup' AND NEW.amount > 0 THEN
        SELECT COALESCE(SUM(amount), 0) INTO v_balance
        FROM public.wallet_transactions
        WHERE user_id = NEW.user_id;

        IF v_balance >= -30000 THEN
            UPDATE public.drivers
            SET is_online = true,
                updated_at = now()
            WHERE user_id = NEW.user_id
              AND is_online = false
              AND insurance_expires_at > now(); -- INSURANCE GATE (20261029130000): a topup must never reactivate (or be aborted for) a driver with no/expired insurance
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;


-- ── 4. driver_location_ping: a ping onlines only a compliant driver ──
CREATE OR REPLACE FUNCTION public.driver_location_ping(p_lat double precision, p_lng double precision, p_heading double precision DEFAULT 0, p_speed double precision DEFAULT 0)
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

  SELECT d.id, d.spoof_suspended, d.last_seen, d.active_ride_id, d.insurance_expires_at
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
           is_online = (v_driver.insurance_expires_at IS NOT NULL AND v_driver.insurance_expires_at > v_now), last_seen = v_now -- INSURANCE GATE (20261029130000): a ping no longer onlines a driver with no/expired insurance
     WHERE id = v_driver.id;
  END IF;

  RETURN jsonb_build_object('success', true, 'snapshot', v_write_snapshot);
END;
$function$;


-- ── 5. update_driver_location_packet: same treatment ──
CREATE OR REPLACE FUNCTION public.update_driver_location_packet(p_lat double precision, p_lng double precision, p_heading double precision DEFAULT NULL::double precision, p_speed double precision DEFAULT NULL::double precision)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_driver_id UUID;
  v_prev_lat DOUBLE PRECISION;
  v_prev_lng DOUBLE PRECISION;
  v_prev_timestamp TIMESTAMPTZ;
  v_insurance_expires_at TIMESTAMPTZ;
  v_timestamp TIMESTAMPTZ := NOW();
BEGIN
  v_driver_id := auth.uid();
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING HINT = 'Not authenticated';
  END IF;

  SELECT lat, lng, last_location_update, insurance_expires_at INTO v_prev_lat, v_prev_lng, v_prev_timestamp, v_insurance_expires_at
  FROM drivers WHERE id = v_driver_id;

  IF v_prev_lat IS NOT NULL AND v_prev_lng IS NOT NULL THEN
    IF NOT check_gps_spoof(
      p_driver_id := v_driver_id,
      p_new_lat := p_lat,
      p_new_lng := p_lng,
      p_prev_lat := v_prev_lat,
      p_prev_lng := v_prev_lng,
      p_prev_timestamp := v_prev_timestamp,
      p_timestamp := v_timestamp
    ) THEN
      RETURN;
    END IF;
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
    is_online = (v_insurance_expires_at IS NOT NULL AND v_insurance_expires_at > v_timestamp),
    status = CASE WHEN v_insurance_expires_at IS NOT NULL AND v_insurance_expires_at > v_timestamp THEN 'online' ELSE status END -- INSURANCE GATE (20261029130000)
  WHERE id = v_driver_id;
END;
$function$;


-- ── 6. claim_available_driver: no offers to the uninsured ──
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
      AND d.insurance_expires_at > now() -- INSURANCE GATE (20261029130000): NULL or past expiry is never offered a ride
      AND d.location IS NOT NULL
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


-- ── 7. find_nearest_online_drivers: no offers to the uninsured ──
CREATE OR REPLACE FUNCTION public.find_nearest_online_drivers(p_lat double precision, p_lng double precision, p_radius_meters double precision DEFAULT 3000, p_limit integer DEFAULT 1)
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
    AND d.insurance_expires_at > now() -- INSURANCE GATE (20261029130000): NULL or past expiry is never offered a ride
    AND d.location IS NOT NULL
    AND GREATEST(d.last_seen, d.last_location_update) > now() - interval '5 minutes'
    AND ST_DWithin(d.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_radius_meters)
  ORDER BY distance_m ASC
  LIMIT p_limit;
$function$;
