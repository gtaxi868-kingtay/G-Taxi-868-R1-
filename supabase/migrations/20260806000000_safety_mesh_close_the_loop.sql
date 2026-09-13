-- ═══════════════════════════════════════════════════════════════════════════
-- SAFETY MESH — close the loop on "mark yourself safe"
-- (2026-08-06)
--
-- WHAT WAS BROKEN
-- ---------------
-- Three safety signals existed and none of them reached anyone in time:
--
--   1. SOS (edge fn trigger_emergency) logged to emergency_logs and messaged
--      the RIDER'S OWN emergency contact. It notified NOBODY at G-Taxi. Its
--      own confirmation message promises "a safety specialist will review it
--      shortly" — there was no path by which any specialist learned of it.
--
--   2. "Mark yourself safe" (20260717000000) worked, and its sweep wrote a
--      system_alerts row DIRECTLY rather than through raise_admin_alert — so
--      no admin push ever fired for a driver who went silent.
--
--   3. Nothing told other drivers anything. A driver marking safe was
--      accountability theatre: the signal went into a column and died there.
--      The point of a mesh of nodes, zones and drivers is that a safety
--      observation at a point is worth something to the next person who goes
--      there. None of that existed.
--
-- WHAT THIS DOES
-- --------------
--   * Every safety signal now reaches an admin through raise_admin_alert —
--     the single existing way to reach a human (durable system_alerts row,
--     plus best-effort Expo push, no shared secret needed).
--   * G AI is hooked in FOR FREE by that same choice: g_agent_runner's
--     get_open_alerts tool reads unresolved system_alerts from the last 7
--     days. Anything raised here is visible to G on its next run without a
--     single line of AI code changing.
--   * Drivers near a drop are told a colleague is working their area, and
--     told when a colleague near them has gone silent or raised an SOS.
--   * Every observation lands in zone_safety_events — the "updated points"
--     layer. get_area_safety() reads it back as aggregates, for the driver
--     app and for G.
--
-- PRIVACY — DELIBERATE CONSTRAINTS, DO NOT RELAX
-- ----------------------------------------------
--   * zone_safety_events stores NO rider id and NO address text. If it did,
--     it would become a shadow trip history readable by every driver, which
--     is exactly what docs/legal/PRIVACY_POLICY.md 4.1 promises never happens.
--   * The table is revoked from anon and authenticated outright. Clients read
--     ONLY aggregates, through get_area_safety(). Precise points never leave
--     the server.
--   * Nearby-driver pushes name no rider, no colleague, no plate, and no
--     street. They carry a coarse distance bucket and nothing else.
--
-- LIVE STATE AT WRITE TIME (checked, not assumed)
-- -----------------------------------------------
--   drivers: 14 rows, 10 flagged online, 1 with any coordinates, 0 with a
--   push_token, 0 seen in 24h. So the push half of this is a no-op TODAY —
--   exactly as it already is for admins (see 20260801030000's closing note).
--   The durable rows are the guarantee; push is the accelerator that starts
--   working the moment a real device registers. Building it the other way
--   round would mean rebuilding it later.
--
--   drivers.location is geography(Point,4326) but is populated on 1 of 14
--   rows, while lat/lng are the columns the apps actually write. Proximity
--   therefore COALESCEs: location first, lat/lng second. Using location
--   alone would silently match nobody.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- 1. Alert types. CHECK constraints reject unknown values silently at the
--    call site, so the full list is dropped and re-added per project
--    convention (same as 20260717000000 did).
-- ---------------------------------------------------------------------------
ALTER TABLE public.system_alerts DROP CONSTRAINT IF EXISTS system_alerts_type_check;
ALTER TABLE public.system_alerts ADD CONSTRAINT system_alerts_type_check
  CHECK (type = ANY (ARRAY[
    'RECONCILIATION_FAILURE','PAYMENT_ANOMALY','GPS_SPOOF_ESCALATION',
    'STATE_MACHINE_VIOLATION','RATE_LIMIT_BURST','ADMIN_OVERRIDE',
    'DRIVER_SAFETY_TIMEOUT','WATCHDOG_ANOMALY','LEASE_DEFAULT',
    'G_BUDGET_EXHAUSTED','GARAGE_REQUEST','ESCAPE_GROUP_READY',
    'EMERGENCY_SOS','AREA_SAFETY_CONCERN']));

-- ---------------------------------------------------------------------------
-- 2. The safety-point ledger.
--    One row per observation at a place. This is the layer that makes a
--    "mark safe" tap worth something to the next driver.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.zone_safety_events (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type   text NOT NULL CHECK (event_type IN (
                   'drop_completed',   -- a drop happened here
                   'marked_safe',      -- driver confirmed they left fine
                   'no_response',      -- driver never checked in (the signal
                                       -- that actually means something)
                   'sos')),            -- alarm raised here
    driver_id    uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
    ride_id      uuid REFERENCES public.rides(id)   ON DELETE SET NULL,
    order_id     uuid REFERENCES public.orders(id)  ON DELETE SET NULL,
    territory_id uuid REFERENCES public.territories(id) ON DELETE SET NULL,
    lat          double precision,
    lng          double precision,
    geom         geography(Point,4326),
    occurred_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zone_safety_events_geom_idx
    ON public.zone_safety_events USING GIST (geom);
CREATE INDEX IF NOT EXISTS zone_safety_events_occurred_idx
    ON public.zone_safety_events (occurred_at DESC);

-- Supabase GRANTs ALL on new public tables to anon/authenticated by default.
-- Revoke BEFORE anything else — this table is server-side only, always.
ALTER TABLE public.zone_safety_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zone_safety_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.zone_safety_events FROM anon, authenticated;

COMMENT ON TABLE public.zone_safety_events IS
'Safety observations at a point. NO rider id and NO address by design — it must never become a trip history readable by drivers. Clients read aggregates only, via get_area_safety().';

-- Per-driver push cooldown, so a busy zone cannot spam a driver's phone.
CREATE TABLE IF NOT EXISTS public.driver_area_ping_log (
    driver_id    uuid PRIMARY KEY REFERENCES public.drivers(id) ON DELETE CASCADE,
    last_ping_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.driver_area_ping_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_area_ping_log FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_area_ping_log FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Tunables. Same g_config pattern as driver_safety, so radius and
--    cooldown change without a redeploy.
-- ---------------------------------------------------------------------------
INSERT INTO public.g_config (key, value)
VALUES ('zone_awareness', jsonb_build_object(
          'enabled',            true,
          'drop_radius_m',      2000,   -- who hears about a routine drop
          'incident_radius_m',  5000,   -- who hears about silence or an SOS
          'cooldown_minutes',   20,     -- per-driver, routine drops only
          'announce_drops',     true,   -- routine drop pings; incidents ignore this
          'lookback_days',      30))    -- window get_area_safety reports on
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. record_zone_safety_event — the single writer.
--    Coordinates are resolved server-side from the ride/order, never taken
--    from a caller, so a client cannot plant a false safety point.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_zone_safety_event(
    p_event_type text,
    p_driver_id  uuid,
    p_ride_id    uuid DEFAULT NULL,
    p_order_id   uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_lat  double precision;
    v_lng  double precision;
    v_terr uuid;
    v_id   uuid;
BEGIN
    -- Prefer the drop-off point of the ride; fall back to the driver's last
    -- known position. Both are server-held values.
    IF p_ride_id IS NOT NULL THEN
        SELECT dropoff_lat, dropoff_lng INTO v_lat, v_lng
          FROM public.rides WHERE id = p_ride_id;
    END IF;

    IF v_lat IS NULL AND p_driver_id IS NOT NULL THEN
        SELECT lat, lng INTO v_lat, v_lng
          FROM public.drivers WHERE id = p_driver_id;
    END IF;

    SELECT territory_id INTO v_terr FROM public.drivers WHERE id = p_driver_id;

    INSERT INTO public.zone_safety_events
        (event_type, driver_id, ride_id, order_id, territory_id, lat, lng, geom)
    VALUES (
        p_event_type, p_driver_id, p_ride_id, p_order_id, v_terr, v_lat, v_lng,
        CASE WHEN v_lat IS NOT NULL AND v_lng IS NOT NULL
             THEN ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography
             END)
    RETURNING id INTO v_id;

    RETURN v_id;
EXCEPTION WHEN OTHERS THEN
    -- A safety LEDGER write must never break the operation that produced the
    -- signal. Losing a point is bad; failing a ride completion is worse.
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.record_zone_safety_event(text,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_zone_safety_event(text,uuid,uuid,uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. notify_drivers_nearby — the mesh ping.
--    Best-effort Expo push to online drivers within radius, honouring the
--    cooldown for routine traffic. Carries NO identifying detail about
--    anyone: not the rider, not the colleague, not the street.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_drivers_nearby(
    p_lat               double precision,
    p_lng               double precision,
    p_radius_m          integer,
    p_title             text,
    p_body              text,
    p_exclude_driver_id uuid DEFAULT NULL,
    p_bypass_cooldown   boolean DEFAULT false,
    p_data              jsonb DEFAULT '{}'::jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_cfg      jsonb;
    v_cooldown integer;
    v_origin   geography;
    v_count    integer := 0;
    rec        record;
BEGIN
    IF p_lat IS NULL OR p_lng IS NULL THEN
        RETURN 0;
    END IF;

    v_cfg      := (SELECT value FROM public.g_config WHERE key = 'zone_awareness');
    v_cooldown := COALESCE((v_cfg->>'cooldown_minutes')::integer, 20);
    v_origin   := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;

    FOR rec IN
        SELECT d.id, d.push_token
          FROM public.drivers d
         WHERE d.is_online = true
           AND COALESCE(d.is_bot, false) = false
           AND (p_exclude_driver_id IS NULL OR d.id <> p_exclude_driver_id)
           AND ST_DWithin(
                 COALESCE(
                   d.location,
                   CASE WHEN d.lat IS NOT NULL AND d.lng IS NOT NULL
                        THEN ST_SetSRID(ST_MakePoint(d.lng, d.lat), 4326)::geography
                        END),
                 v_origin, p_radius_m)
           AND (p_bypass_cooldown
                OR NOT EXISTS (
                     SELECT 1 FROM public.driver_area_ping_log l
                      WHERE l.driver_id = d.id
                        AND l.last_ping_at > now() - (v_cooldown::text || ' minutes')::interval))
    LOOP
        -- Record the ping regardless of whether a device is reachable, so the
        -- cooldown is honest even while push_token is NULL across the fleet.
        INSERT INTO public.driver_area_ping_log (driver_id, last_ping_at)
        VALUES (rec.id, now())
        ON CONFLICT (driver_id) DO UPDATE SET last_ping_at = now();

        v_count := v_count + 1;

        IF rec.push_token LIKE 'ExponentPushToken%' THEN
            BEGIN
                PERFORM net.http_post(
                    url     := 'https://exp.host/--/api/v2/push/send',
                    headers := jsonb_build_object('Content-Type','application/json'),
                    body    := jsonb_build_object(
                        'to', rec.push_token, 'title', p_title, 'body', p_body,
                        'sound', 'default', 'data', p_data));
            EXCEPTION WHEN OTHERS THEN
                NULL;  -- one unreachable device must not stop the rest
            END;
        END IF;
    END LOOP;

    RETURN v_count;
EXCEPTION WHEN OTHERS THEN
    RETURN 0;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_drivers_nearby(double precision,double precision,integer,text,text,uuid,boolean,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_drivers_nearby(double precision,double precision,integer,text,text,uuid,boolean,jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. get_area_safety — what a driver (or G) can read back.
--    Aggregates only. Never returns a point, a driver id or a ride id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_area_safety(
    p_lat      double precision,
    p_lng      double precision,
    p_radius_m integer DEFAULT 2000
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_cfg      jsonb;
    v_days     integer;
    v_origin   geography;
    v_drops    integer;
    v_safe     integer;
    v_silent   integer;
    v_sos      integer;
    v_rating   text;
BEGIN
    IF p_lat IS NULL OR p_lng IS NULL THEN
        RETURN jsonb_build_object('error', 'coordinates required');
    END IF;

    -- Clamp so a caller cannot turn this into a nationwide scan.
    p_radius_m := LEAST(GREATEST(COALESCE(p_radius_m, 2000), 100), 10000);

    v_cfg    := (SELECT value FROM public.g_config WHERE key = 'zone_awareness');
    v_days   := COALESCE((v_cfg->>'lookback_days')::integer, 30);
    v_origin := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;

    SELECT
        count(*) FILTER (WHERE event_type = 'drop_completed'),
        count(*) FILTER (WHERE event_type = 'marked_safe'),
        count(*) FILTER (WHERE event_type = 'no_response'),
        count(*) FILTER (WHERE event_type = 'sos')
      INTO v_drops, v_safe, v_silent, v_sos
      FROM public.zone_safety_events
     WHERE geom IS NOT NULL
       AND ST_DWithin(geom, v_origin, p_radius_m)
       AND occurred_at > now() - (v_days::text || ' days')::interval;

    -- Deliberately conservative wording. This is an observation count, not a
    -- verdict on a neighbourhood, and it must not read like one.
    v_rating := CASE
        WHEN v_sos > 0                       THEN 'incident_reported'
        WHEN v_silent > 0                    THEN 'check_in_missed'
        WHEN v_drops + v_safe = 0            THEN 'no_data'
        WHEN v_safe >= GREATEST(v_drops, 1)  THEN 'routine'
        ELSE 'limited_data'
    END;

    RETURN jsonb_build_object(
        'radius_m',        p_radius_m,
        'lookback_days',   v_days,
        'drops',           COALESCE(v_drops, 0),
        'marked_safe',     COALESCE(v_safe, 0),
        'check_ins_missed',COALESCE(v_silent, 0),
        'sos_events',      COALESCE(v_sos, 0),
        'status',          v_rating);
END;
$$;

REVOKE ALL ON FUNCTION public.get_area_safety(double precision,double precision,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_area_safety(double precision,double precision,integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_area_safety(double precision,double precision,integer) IS
'Aggregate safety observations near a point. Returns counts and a coarse status only — never a point, driver or ride. Radius clamped to 10km so it cannot be walked into a nationwide scan.';

-- ---------------------------------------------------------------------------
-- 7. mark_ride_safe — unchanged contract, now also drops a safety point.
--    Quiet by design: confirming you are fine should not ping anyone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_ride_safe(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_ride       RECORD;
  v_driver_uid uuid;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF v_ride IS NULL THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;

  SELECT user_id INTO v_driver_uid FROM public.drivers WHERE id = v_ride.driver_id;
  IF v_driver_uid IS NULL OR v_driver_uid <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized: caller is not the assigned driver';
  END IF;

  UPDATE public.rides
     SET driver_safe    = true,
         driver_safe_at = COALESCE(driver_safe_at, now()),
         safety_flagged = false
   WHERE id = p_ride_id;

  -- Only the FIRST confirmation becomes a point, so tapping twice does not
  -- inflate an area's score.
  IF v_ride.driver_safe = false THEN
    PERFORM public.record_zone_safety_event('marked_safe', v_ride.driver_id, p_ride_id, NULL);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'ride_id', p_ride_id,
    'driver_safe_at', COALESCE(v_ride.driver_safe_at, now())
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_ride_safe(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_ride_safe(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_order_safe(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_order      RECORD;
  v_driver_uid uuid;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  SELECT user_id INTO v_driver_uid FROM public.drivers WHERE id = v_order.delivery_driver_id;
  IF v_driver_uid IS NULL OR v_driver_uid <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized: caller is not the assigned delivery driver';
  END IF;

  UPDATE public.orders
     SET driver_safe    = true,
         driver_safe_at = COALESCE(driver_safe_at, now()),
         safety_flagged = false
   WHERE id = p_order_id;

  IF v_order.driver_safe = false THEN
    PERFORM public.record_zone_safety_event('marked_safe', v_order.delivery_driver_id, NULL, p_order_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'driver_safe_at', COALESCE(v_order.driver_safe_at, now())
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_order_safe(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_order_safe(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Drop announcement — an AFTER trigger on the completion transition.
--
--    AFTER, not BEFORE, and every statement inside an exception block: this
--    file will not repeat set_ride_arrived_at(), a BEFORE trigger whose
--    error broke EVERY update to rides for weeks (see 20260718000000).
--    Guarded on the transition itself so a later touch of a completed ride
--    cannot re-announce.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.announce_drop_in_zone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_cfg    jsonb;
    v_radius integer;
BEGIN
    BEGIN
        v_cfg := (SELECT value FROM public.g_config WHERE key = 'zone_awareness');

        IF NOT COALESCE((v_cfg->>'enabled')::boolean, true) THEN
            RETURN NULL;
        END IF;

        PERFORM public.record_zone_safety_event('drop_completed', NEW.driver_id, NEW.id, NULL);

        IF COALESCE((v_cfg->>'announce_drops')::boolean, true) THEN
            v_radius := COALESCE((v_cfg->>'drop_radius_m')::integer, 2000);

            -- No rider, no colleague, no street. Coverage awareness only.
            PERFORM public.notify_drivers_nearby(
                NEW.dropoff_lat, NEW.dropoff_lng, v_radius,
                'A driver is working your area',
                'A G-Taxi driver just completed a drop nearby.',
                NEW.driver_id,
                false,
                jsonb_build_object('type', 'zone_activity'));
        END IF;
    EXCEPTION WHEN OTHERS THEN
        NULL;  -- never let awareness break a completing ride
    END;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_announce_drop_in_zone ON public.rides;
CREATE TRIGGER trg_announce_drop_in_zone
    AFTER UPDATE OF status ON public.rides
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'completed')
    EXECUTE FUNCTION public.announce_drop_in_zone();

-- ---------------------------------------------------------------------------
-- 9. sweep_driver_safety — now actually reaches someone.
--    Was: INSERT INTO system_alerts (row only, no push, no mesh).
--    Now: raise_admin_alert (row + push + visible to G's get_open_alerts),
--         a 'no_response' safety point, and a warning to nearby drivers.
--    Everything else — the cutoff, the idempotency guard, the orders gate —
--    is preserved exactly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sweep_driver_safety()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_cfg          jsonb;
  v_zone_cfg     jsonb;
  v_enabled      boolean;
  v_timeout_min  integer;
  v_cover_orders boolean;
  v_cutoff       interval;
  v_launch_at    timestamptz;
  v_inc_radius   integer;
  v_count        integer := 0;
  v_driver_name  text;
  rec            record;
BEGIN
  v_cfg          := (SELECT value FROM public.g_config WHERE key = 'driver_safety');
  v_zone_cfg     := (SELECT value FROM public.g_config WHERE key = 'zone_awareness');
  v_enabled      := COALESCE((v_cfg->>'enabled')::boolean, true);
  v_timeout_min  := COALESCE((v_cfg->>'timeout_minutes')::integer, 30);
  v_cover_orders := COALESCE((v_cfg->>'cover_orders')::boolean, false);
  v_cutoff       := (v_timeout_min::text || ' minutes')::interval;
  v_launch_at    := COALESCE((v_cfg->>'launch_at')::timestamptz, '-infinity'::timestamptz);
  v_inc_radius   := COALESCE((v_zone_cfg->>'incident_radius_m')::integer, 5000);

  IF NOT v_enabled THEN
    RETURN 0;
  END IF;

  FOR rec IN
    SELECT r.id, r.driver_id, r.completed_at, r.dropoff_lat, r.dropoff_lng
    FROM public.rides r
    WHERE r.status IN ('completed', 'closed')
      AND r.driver_id IS NOT NULL
      AND r.driver_safe = false
      AND r.safety_flagged = false
      AND r.completed_at IS NOT NULL
      AND r.completed_at >= v_launch_at
      AND r.completed_at < now() - v_cutoff
      AND NOT EXISTS (
        SELECT 1 FROM public.system_alerts a
        WHERE a.type = 'DRIVER_SAFETY_TIMEOUT'
          AND a.resolved_at IS NULL
          AND a.details->>'ride_id' = r.id::text
      )
  LOOP
    SELECT name INTO v_driver_name FROM public.drivers WHERE id = rec.driver_id;

    PERFORM public.raise_admin_alert(
      'DRIVER_SAFETY_TIMEOUT',
      'Driver has not checked in',
      format('%s has not marked safe %s minutes after completing a ride. Contact them.',
             COALESCE(v_driver_name, 'A driver'), v_timeout_min),
      'HIGH',
      jsonb_build_object(
        'entity',          'ride',
        'ride_id',         rec.id,
        'driver_id',       rec.driver_id,
        'completed_at',    rec.completed_at,
        'timeout_minutes', v_timeout_min));

    PERFORM public.record_zone_safety_event('no_response', rec.driver_id, rec.id, NULL);

    -- The colleagues nearest to a silent driver are the ones who can act
    -- fastest. Cooldown bypassed: this is not routine traffic.
    PERFORM public.notify_drivers_nearby(
      rec.dropoff_lat, rec.dropoff_lng, v_inc_radius,
      'Driver check-in missed nearby',
      'A driver has not checked in after a drop in your area. Stay aware.',
      rec.driver_id,
      true,
      jsonb_build_object('type', 'safety_watch'));

    UPDATE public.rides SET safety_flagged = true WHERE id = rec.id;
    v_count := v_count + 1;
  END LOOP;

  IF v_cover_orders THEN
    FOR rec IN
      SELECT o.id, o.delivery_driver_id AS driver_id, o.actual_delivery_at
      FROM public.orders o
      WHERE o.status = 'delivered'
        AND o.delivery_driver_id IS NOT NULL
        AND o.driver_safe = false
        AND o.safety_flagged = false
        AND o.actual_delivery_at IS NOT NULL
        AND o.actual_delivery_at >= v_launch_at
        AND o.actual_delivery_at < now() - v_cutoff
        AND NOT EXISTS (
          SELECT 1 FROM public.system_alerts a
          WHERE a.type = 'DRIVER_SAFETY_TIMEOUT'
            AND a.resolved_at IS NULL
            AND a.details->>'order_id' = o.id::text
        )
    LOOP
      SELECT name INTO v_driver_name FROM public.drivers WHERE id = rec.driver_id;

      PERFORM public.raise_admin_alert(
        'DRIVER_SAFETY_TIMEOUT',
        'Driver has not checked in',
        format('%s has not marked safe %s minutes after completing a delivery. Contact them.',
               COALESCE(v_driver_name, 'A driver'), v_timeout_min),
        'HIGH',
        jsonb_build_object(
          'entity',          'order',
          'order_id',        rec.id,
          'driver_id',       rec.driver_id,
          'completed_at',    rec.actual_delivery_at,
          'timeout_minutes', v_timeout_min));

      PERFORM public.record_zone_safety_event('no_response', rec.driver_id, NULL, rec.id);

      UPDATE public.orders SET safety_flagged = true WHERE id = rec.id;
      v_count := v_count + 1;
    END LOOP;
  END IF;

  RETURN v_count;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 10. handle_sos — everything an SOS must set off, in one place.
--     Called by the trigger_emergency edge function AFTER it has verified
--     the caller is on the ride. It does not re-check identity; it is
--     service_role only and is not reachable from a client.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_sos(
    p_ride_id     uuid,
    p_raised_by   uuid,
    p_raiser_role text DEFAULT 'rider'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_ride        RECORD;
    v_driver_name text;
    v_lat         double precision;
    v_lng         double precision;
    v_radius      integer;
    v_alert_id    uuid;
    v_nearby      integer := 0;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
    IF v_ride IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'ride not found');
    END IF;

    SELECT name, lat, lng INTO v_driver_name, v_lat, v_lng
      FROM public.drivers WHERE id = v_ride.driver_id;

    -- Driver's live position is the best guess at where the trouble is;
    -- fall back to the intended drop-off.
    v_lat := COALESCE(v_lat, v_ride.dropoff_lat);
    v_lng := COALESCE(v_lng, v_ride.dropoff_lng);

    -- (1) Reach a human. CRITICAL, and G sees it through get_open_alerts.
    v_alert_id := public.raise_admin_alert(
        'EMERGENCY_SOS',
        'SOS raised on an active ride',
        format('An SOS was raised by the %s on ride %s. Driver: %s. Act now.',
               p_raiser_role, left(p_ride_id::text, 8), COALESCE(v_driver_name, 'unknown')),
        'CRITICAL',
        jsonb_build_object(
            'ride_id',    p_ride_id,
            'raised_by',  p_raised_by,
            'role',       p_raiser_role,
            'driver_id',  v_ride.driver_id,
            'rider_id',   v_ride.rider_id,
            'lat',        v_lat,
            'lng',        v_lng));

    -- (2) The point on the map.
    PERFORM public.record_zone_safety_event('sos', v_ride.driver_id, p_ride_id, NULL);

    -- (3) The people physically closest. No names, no rider, no address.
    v_radius := COALESCE(
        (SELECT (value->>'incident_radius_m')::integer FROM public.g_config WHERE key = 'zone_awareness'),
        5000);

    v_nearby := public.notify_drivers_nearby(
        v_lat, v_lng, v_radius,
        'Emergency alert nearby',
        'An emergency alert was raised near your location. Be alert. Call 999 if you see danger.',
        v_ride.driver_id,
        true,
        jsonb_build_object('type', 'sos_nearby'));

    RETURN jsonb_build_object(
        'success',          true,
        'alert_id',         v_alert_id,
        'drivers_notified', v_nearby);
EXCEPTION WHEN OTHERS THEN
    -- The edge function has already written emergency_logs and messaged the
    -- rider's contact. Never let this escalation path fail that.
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.handle_sos(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_sos(uuid,uuid,text) TO service_role;

COMMENT ON FUNCTION public.handle_sos(uuid,uuid,text) IS
'Fan-out for an SOS: admin alert (also read by G via get_open_alerts), safety point, and a warning to nearby drivers. service_role only — the caller must have already verified the raiser is on the ride.';
