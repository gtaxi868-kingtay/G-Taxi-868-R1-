-- ============================================================================
-- Scout auto-trigger: "drivers as sensors -> business map"
-- ============================================================================
-- Closes the community/zone-level unlock gap: per-rider progression was wired,
-- but nothing watched aggregate zone activity to suggest planting a commander.
--
-- Loop:
--   1. A completed ride (status -> 'completed') or a delivered order
--      (status -> 'delivered') increments an activity counter for the ~1.1km
--      geographic cell containing the trip's fulfilment endpoint.
--   2. A pure-SQL sweep (pg_cron) scans for cells whose rolling-window count has
--      crossed a configurable threshold and files ONE proposal into the
--      g_proposed_actions approval inbox: "Scout a commander near (lat,lng)".
--   3. HARD GUARDRAIL: it NEVER auto-adds a commander or onboards anything.
--      It only files a proposal. An admin approves via the existing inbox.
--   4. Dedupe: at most one OPEN (pending) proposal per cell.
--
-- CELL SCHEME: round(lat,2) / round(lng,2) -> ~1.1km grid. cell_key is the text
--   'lat_lng' of those rounded coords; the same rounded coords are the centroid.
--
-- THRESHOLD (tunable via g_config, no redeploy): 25 completed trips per cell per
--   rolling 30 days. Chosen as a sane pre-launch number for Trinidad & Tobago
--   community density -- enough repeat traffic to justify seeding a commander,
--   low enough to fire pre-launch. Window is a cheap tumbling reset (see RPC).
--
-- No new edge function is deployed (project is near the 100-fn plan cap); the
-- whole loop is table + SECURITY DEFINER RPCs + triggers + one in-DB cron job.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Config (tunable without a deploy)
-- ---------------------------------------------------------------------------
INSERT INTO public.g_config (key, value)
VALUES (
  'scout_trigger',
  jsonb_build_object('enabled', true, 'threshold', 25, 'window_days', 30)
)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Activity table (one row per cell)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.scout_zone_activity (
  cell_key          text PRIMARY KEY,
  centroid_lat      double precision NOT NULL,
  centroid_lng      double precision NOT NULL,
  completed_count   integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  last_event_at     timestamptz NOT NULL DEFAULT now(),
  proposal_status   text NOT NULL DEFAULT 'none'
                       CHECK (proposal_status IN ('none', 'proposed')),
  proposal_id       uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scout_zone_activity_hot
  ON public.scout_zone_activity (completed_count)
  WHERE proposal_status = 'none';

-- Locked down: only SECURITY DEFINER functions and the service role touch it.
ALTER TABLE public.scout_zone_activity ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. Increment RPC -- concurrency-safe via INSERT ... ON CONFLICT DO UPDATE.
--    Tumbling rolling window: if the existing window is older than the
--    configured window, the counter resets to 1 and a fresh window starts
--    (which also clears any stale proposal linkage so a re-cross can re-file).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scout_record_completion(
  p_lat double precision,
  p_lng double precision
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_cell        text;
  v_clat        double precision;
  v_clng        double precision;
  v_window_days integer;
  v_window      interval;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RETURN;
  END IF;

  v_window_days := COALESCE(
    (SELECT (value->>'window_days')::integer FROM public.g_config WHERE key = 'scout_trigger'),
    30
  );
  v_window := (v_window_days::text || ' days')::interval;

  v_clat := round(p_lat::numeric, 2)::double precision;
  v_clng := round(p_lng::numeric, 2)::double precision;
  v_cell := round(p_lat::numeric, 2)::text || '_' || round(p_lng::numeric, 2)::text;

  INSERT INTO public.scout_zone_activity AS sza (
    cell_key, centroid_lat, centroid_lng,
    completed_count, window_started_at, last_event_at
  )
  VALUES (v_cell, v_clat, v_clng, 1, now(), now())
  ON CONFLICT (cell_key) DO UPDATE SET
    completed_count = CASE
      WHEN sza.window_started_at < now() - v_window THEN 1
      ELSE sza.completed_count + 1
    END,
    window_started_at = CASE
      WHEN sza.window_started_at < now() - v_window THEN now()
      ELSE sza.window_started_at
    END,
    proposal_status = CASE
      WHEN sza.window_started_at < now() - v_window THEN 'none'
      ELSE sza.proposal_status
    END,
    proposal_id = CASE
      WHEN sza.window_started_at < now() - v_window THEN NULL
      ELSE sza.proposal_id
    END,
    last_event_at = now();
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Trigger functions -- fire on completion, endpoint = fulfilment location.
--    ride  -> dropoff_lat/lng   order -> delivery_lat/lng
--    Wrapped so a scout bookkeeping failure can NEVER roll back or block the
--    underlying ride/order completion.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scout_on_ride_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  BEGIN
    PERFORM public.scout_record_completion(NEW.dropoff_lat, NEW.dropoff_lng);
  EXCEPTION WHEN OTHERS THEN
    -- swallow: never block a ride completion on scout bookkeeping
    NULL;
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.scout_on_order_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  BEGIN
    PERFORM public.scout_record_completion(NEW.delivery_lat, NEW.delivery_lng);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scout_on_ride_complete ON public.rides;
CREATE TRIGGER trg_scout_on_ride_complete
AFTER UPDATE ON public.rides
FOR EACH ROW
WHEN (
  NEW.status = 'completed'
  AND OLD.status IS DISTINCT FROM 'completed'
  AND NEW.dropoff_lat IS NOT NULL
  AND NEW.dropoff_lng IS NOT NULL
)
EXECUTE FUNCTION public.scout_on_ride_complete();

DROP TRIGGER IF EXISTS trg_scout_on_order_complete ON public.orders;
CREATE TRIGGER trg_scout_on_order_complete
AFTER UPDATE ON public.orders
FOR EACH ROW
WHEN (
  NEW.status = 'delivered'
  AND OLD.status IS DISTINCT FROM 'delivered'
  AND NEW.delivery_lat IS NOT NULL
  AND NEW.delivery_lng IS NOT NULL
)
EXECUTE FUNCTION public.scout_on_order_complete();

-- ---------------------------------------------------------------------------
-- 5. Sweep RPC -- files at most one PENDING proposal per cell over threshold.
--    Returns the number of proposals filed this run.
--    Dedupe is authoritative: guards on NOT EXISTS a pending proposal whose
--    payload.cell_key matches -- survives even if the activity row drifted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scout_sweep_zones()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_cfg         jsonb;
  v_enabled     boolean;
  v_threshold   integer;
  v_window_days integer;
  v_window      interval;
  v_count       integer := 0;
  v_pid         uuid;
  rec           record;
BEGIN
  v_cfg := (SELECT value FROM public.g_config WHERE key = 'scout_trigger');
  v_enabled     := COALESCE((v_cfg->>'enabled')::boolean, true);
  v_threshold   := COALESCE((v_cfg->>'threshold')::integer, 25);
  v_window_days := COALESCE((v_cfg->>'window_days')::integer, 30);
  v_window      := (v_window_days::text || ' days')::interval;

  IF NOT v_enabled THEN
    RETURN 0;
  END IF;

  FOR rec IN
    SELECT sza.*
    FROM public.scout_zone_activity sza
    WHERE sza.completed_count >= v_threshold
      AND sza.window_started_at >= now() - v_window   -- still inside the window
      AND NOT EXISTS (
        SELECT 1 FROM public.g_proposed_actions g
        WHERE g.status = 'pending'
          AND g.action_type = 'scout_commander'
          AND g.payload->>'cell_key' = sza.cell_key
      )
    ORDER BY sza.completed_count DESC
  LOOP
    INSERT INTO public.g_proposed_actions (
      department, action_type, title, reasoning, payload, category, expires_at
    )
    VALUES (
      'scout',
      'scout_commander',
      format('Scout a commander near (%s, %s)', round(rec.centroid_lat::numeric, 2), round(rec.centroid_lng::numeric, 2)),
      format(
        'Zone cell %s logged %s completed trips in the last %s days (rolling), crossing the scouting threshold of %s. '
        || 'Centroid approx (%s, %s). Proposing to scout a commander to seed local merchants and drivers in this community. '
        || 'This is a proposal only -- no commander is added and nothing is onboarded until an admin approves.',
        rec.cell_key,
        rec.completed_count,
        v_window_days,
        v_threshold,
        round(rec.centroid_lat::numeric, 2),
        round(rec.centroid_lng::numeric, 2)
      ),
      jsonb_build_object(
        'source', 'scout_auto_trigger',
        'cell_key', rec.cell_key,
        'centroid_lat', rec.centroid_lat,
        'centroid_lng', rec.centroid_lng,
        'completed_count', rec.completed_count,
        'threshold', v_threshold,
        'window_days', v_window_days,
        'window_started_at', rec.window_started_at
      ),
      'config',
      now() + interval '14 days'
    )
    RETURNING id INTO v_pid;

    UPDATE public.scout_zone_activity
       SET proposal_status = 'proposed', proposal_id = v_pid
     WHERE cell_key = rec.cell_key;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Cron -- pure in-DB sweep (no edge function, no http, no secret).
--    Hourly at minute 20 to avoid colliding with other jobs.
-- ---------------------------------------------------------------------------
SELECT cron.unschedule('scout-sweep-zones')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scout-sweep-zones');

SELECT cron.schedule('scout-sweep-zones', '20 * * * *', $cron$SELECT public.scout_sweep_zones();$cron$);
