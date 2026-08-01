-- ============================================================================
-- Grid #1: Zone-enter cross-notify ("foreign driver dropping in our area")
-- ============================================================================
-- Grid situational-awareness for drivers (esp. carnival / event ops).
--
-- When a driver whose HOME territory differs from the area they just dropped in
-- reaches the dropoff (ride status -> 'completed'), ping the LOCAL online
-- drivers physically near that dropoff:
--   "Out-of-area driver (from <home area>) dropping at <area> — ~2 min."
--
-- WHY 'completed' is the hook: the rides state machine is
--   searching -> assigned -> arrived(at pickup) -> in_progress -> completed.
-- There is NO dedicated "arrived-at-dropoff" state; 'arrived' means arrived at
-- PICKUP. 'completed' is the transition that means the driver is at / leaving
-- the dropoff. So we fire AFTER UPDATE on rides on the ->'completed' edge, the
-- same edge emit_ride_notification and scout_on_ride_complete already hook.
--
-- LOCAL vs FOREIGN: compared purely on drivers.territory_id (home territory,
-- already assigned). territories.boundary_geojson is jsonb (NOT PostGIS), so we
-- do NOT attempt point-in-polygon. "Near the dropoff" is derived purely from
-- driver position proximity via PostGIS ST_DWithin on geography.
--
-- POSITION SOURCE — schema surprise (see report): driver_locations is EMPTY and
-- unused (0 rows). The authoritative live driver position lives on
-- drivers.location (geography, SRID 4326), co-located with is_online,
-- territory_id and user_id — so recipient selection reads from `drivers`, with a
-- lat/lng fallback for rows where the geography column has not been backfilled.
--
-- SAFETY: the whole body is wrapped BEGIN..EXCEPTION WHEN OTHERS THEN NULL so a
-- notify failure can NEVER roll back or block a real ride completion (same
-- discipline as scout_on_ride_complete in 20260716000000).
--
-- No new edge function is deployed (project near the 100-fn cap). notify_user()
-- inserts into notifications, which already drives push. No cron: purely trigger
-- driven, so there is no historical-backlog storm risk.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Allow the new 'grid' notification type.
--    notifications.type has a CHECK constraint (whitelist). A new value is
--    silently rejected -> the trigger's EXCEPTION handler would swallow the
--    insert and no ping would ever land. Extend the whitelist (DROP + ADD the
--    FULL list, per the CHECK-constraint gotcha).
-- ---------------------------------------------------------------------------
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY[
    'ride','payment','promo','escape','grocery','laundry',
    'carnival','order','system','grid'
  ]));

-- ---------------------------------------------------------------------------
-- 1. Config (tunable without a deploy)
--    radius_m           : how near the dropoff a driver must be to be pinged
--    max_recipients     : cap on nearest drivers notified per drop
--    eta_minutes        : the "~N min" figure shown in the ping copy
--    stale_after_minutes: if > 0, a driver whose last position update is older
--                         than this is skipped (NULL timestamp = treated as
--                         eligible, since seed rows carry no timestamp yet)
-- ---------------------------------------------------------------------------
INSERT INTO public.g_config (key, value)
VALUES (
  'zone_cross_notify',
  jsonb_build_object(
    'enabled', true,
    'radius_m', 3000,
    'max_recipients', 10,
    'eta_minutes', 2,
    'stale_after_minutes', 15
  )
)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Trigger function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.zone_cross_notify_on_drop()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_cfg           jsonb;
  v_enabled       boolean;
  v_radius_m      double precision;
  v_max           integer;
  v_eta           integer;
  v_stale_min     integer;
  v_drop_terr     uuid;
  v_home_area     text;
  v_drop_area     text;
  v_dropoff       geography;
  rec             record;
BEGIN
  BEGIN
    v_cfg := (SELECT value FROM public.g_config WHERE key = 'zone_cross_notify');

    v_enabled   := COALESCE((v_cfg->>'enabled')::boolean, true);
    IF NOT v_enabled THEN
      RETURN NEW;
    END IF;

    v_radius_m  := COALESCE((v_cfg->>'radius_m')::double precision, 3000);
    v_max       := COALESCE((v_cfg->>'max_recipients')::integer, 10);
    v_eta       := COALESCE((v_cfg->>'eta_minutes')::integer, 2);
    v_stale_min := COALESCE((v_cfg->>'stale_after_minutes')::integer, 15);

    -- Dropping driver's HOME territory. rides.driver_id = drivers.id.
    SELECT d.territory_id, t.name
      INTO v_drop_terr, v_home_area
      FROM public.drivers d
      LEFT JOIN public.territories t ON t.id = d.territory_id
     WHERE d.id = NEW.driver_id;

    -- If the dropping driver has no home territory, "local vs foreign" is
    -- undefined -> do not notify (avoid pinging everyone).
    IF v_drop_terr IS NULL THEN
      RETURN NEW;
    END IF;

    v_home_area := COALESCE(v_home_area, 'another area');

    -- Human label for the drop area (no polygon lookup available): use the
    -- dropoff address, else the rounded coordinates.
    v_drop_area := NULLIF(btrim(COALESCE(NEW.dropoff_address, '')), '');
    IF v_drop_area IS NULL THEN
      v_drop_area := format('(%s, %s)',
        round(NEW.dropoff_lat::numeric, 2),
        round(NEW.dropoff_lng::numeric, 2));
    END IF;

    v_dropoff := ST_SetSRID(ST_MakePoint(NEW.dropoff_lng, NEW.dropoff_lat), 4326)::geography;

    -- Nearest LOCAL online drivers whose home territory differs from the
    -- dropping driver, within radius, excluding the dropping driver.
    FOR rec IN
      SELECT d.user_id
        FROM public.drivers d
        CROSS JOIN LATERAL (
          SELECT COALESCE(
            d.location,
            CASE
              WHEN d.lat IS NOT NULL AND d.lng IS NOT NULL
              THEN ST_SetSRID(ST_MakePoint(d.lng, d.lat), 4326)::geography
            END
          ) AS geo
        ) loc
       WHERE d.is_online = true
         AND d.id <> NEW.driver_id
         AND d.user_id IS NOT NULL
         AND d.territory_id IS DISTINCT FROM v_drop_terr
         AND loc.geo IS NOT NULL
         AND ST_DWithin(loc.geo, v_dropoff, v_radius_m)
         AND (
           v_stale_min <= 0
           OR COALESCE(d.last_location_update, d.last_seen) IS NULL
           OR COALESCE(d.last_location_update, d.last_seen) > now() - make_interval(mins => v_stale_min)
         )
       ORDER BY ST_Distance(loc.geo, v_dropoff) ASC
       LIMIT v_max
    LOOP
      PERFORM public.notify_user(
        rec.user_id,
        'grid',
        'Out-of-area driver in your zone',
        format('Driver from %s dropping at %s — ~%s min away.',
               v_home_area, v_drop_area, v_eta)
      );
    END LOOP;

  EXCEPTION WHEN OTHERS THEN
    -- swallow: a grid-awareness ping must never block a real ride completion
    NULL;
  END;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Trigger — fire only on the ->'completed' edge with a real dropoff coord.
--    Guarded so non-status updates and re-saves of an already-completed ride
--    no-op (matches the transition-guard discipline of the other rides triggers).
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_zone_cross_notify_on_drop ON public.rides;
CREATE TRIGGER trg_zone_cross_notify_on_drop
AFTER UPDATE ON public.rides
FOR EACH ROW
WHEN (
  NEW.status = 'completed'
  AND OLD.status IS DISTINCT FROM 'completed'
  AND NEW.driver_id IS NOT NULL
  AND NEW.dropoff_lat IS NOT NULL
  AND NEW.dropoff_lng IS NOT NULL
)
EXECUTE FUNCTION public.zone_cross_notify_on_drop();
