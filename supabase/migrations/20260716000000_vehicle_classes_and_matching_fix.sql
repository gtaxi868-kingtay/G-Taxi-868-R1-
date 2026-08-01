-- ═══════════════════════════════════════════════════════════════════
-- VEHICLE CLASS SYSTEM + P0 MATCHING FIX (2026-07-16)
--
-- 1) P0: claim_available_driver compared vehicle_type case-sensitively.
--    Rider app sends 'Standard'; every driver row is 'standard' → app
--    bookings with a vehicle type matched ZERO drivers. Fixed with
--    lower() on both sides + drivers rows normalized to lowercase.
--
-- 2) vehicle_classes: admin-controlled ride classes. Replaces the
--    Standard/XL/Premium lists hardcoded in 4 places (rider screen,
--    driver registration, _shared/pricing.ts, and nowhere admin could
--    touch). Seeds heavy classes (truck / hiab / wrecker) INACTIVE —
--    admin flips is_active to open them to riders.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. Vehicle classes table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_classes (
    key             text PRIMARY KEY,
    label           text NOT NULL,
    description     text,
    icon            text NOT NULL DEFAULT 'car-outline',
    multiplier_x100 integer NOT NULL CHECK (multiplier_x100 >= 100),
    category        text NOT NULL DEFAULT 'passenger'
                        CHECK (category IN ('passenger', 'heavy')),
    is_active       boolean NOT NULL DEFAULT false,
    sort_order      integer NOT NULL DEFAULT 100,
    min_fare_cents  integer CHECK (min_fare_cents IS NULL OR min_fare_cents >= 0),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vehicle_classes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read active vehicle classes" ON public.vehicle_classes;
CREATE POLICY "Read active vehicle classes" ON public.vehicle_classes
    FOR SELECT USING (is_active = true);

GRANT SELECT ON public.vehicle_classes TO anon, authenticated;

INSERT INTO public.vehicle_classes
    (key, label, description, icon, multiplier_x100, category, is_active, sort_order, min_fare_cents)
VALUES
    ('standard', 'Standard', 'Daily logistics',        'car-outline',       100, 'passenger', true,  10, NULL),
    ('xl',       'XL',       'Group & Bulk',           'bus-outline',       150, 'passenger', true,  20, NULL),
    ('premium',  'Premium',  'Executive Pro',          'star-outline',      200, 'passenger', true,  30, NULL),
    ('truck',    'Truck',    'Flatbed & cargo moves',  'cube-outline',      300, 'heavy',     false, 40, 15000),
    ('hiab',     'Hiab',     'Crane-arm lifts & drops','construct-outline', 450, 'heavy',     false, 50, 35000),
    ('wrecker',  'Wrecker',  'Towing & recovery',      'build-outline',     350, 'heavy',     false, 60, 20000)
ON CONFLICT (key) DO NOTHING;

-- ─── 2. Admin RPCs (mirrors admin_get_pricing / admin_set_pricing) ───
CREATE OR REPLACE FUNCTION public.admin_get_vehicle_classes()
RETURNS SETOF public.vehicle_classes
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;
    RETURN QUERY SELECT * FROM public.vehicle_classes ORDER BY sort_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_vehicle_class(
    p_key             text,
    p_label           text    DEFAULT NULL,
    p_description     text    DEFAULT NULL,
    p_icon            text    DEFAULT NULL,
    p_multiplier_x100 integer DEFAULT NULL,
    p_category        text    DEFAULT NULL,
    p_is_active       boolean DEFAULT NULL,
    p_sort_order      integer DEFAULT NULL,
    p_min_fare_cents  integer DEFAULT NULL
)
RETURNS public.vehicle_classes
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_row public.vehicle_classes;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;
    IF p_key IS NULL OR length(trim(p_key)) = 0 THEN
        RAISE EXCEPTION 'key required';
    END IF;

    INSERT INTO public.vehicle_classes AS vc
        (key, label, description, icon, multiplier_x100, category, is_active, sort_order, min_fare_cents)
    VALUES (
        lower(trim(p_key)),
        COALESCE(p_label, initcap(p_key)),
        p_description,
        COALESCE(p_icon, 'car-outline'),
        COALESCE(p_multiplier_x100, 100),
        COALESCE(p_category, 'passenger'),
        COALESCE(p_is_active, false),
        COALESCE(p_sort_order, 100),
        p_min_fare_cents
    )
    ON CONFLICT (key) DO UPDATE SET
        label           = COALESCE(p_label, vc.label),
        description     = COALESCE(p_description, vc.description),
        icon            = COALESCE(p_icon, vc.icon),
        multiplier_x100 = COALESCE(p_multiplier_x100, vc.multiplier_x100),
        category        = COALESCE(p_category, vc.category),
        is_active       = COALESCE(p_is_active, vc.is_active),
        sort_order      = COALESCE(p_sort_order, vc.sort_order),
        min_fare_cents  = COALESCE(p_min_fare_cents, vc.min_fare_cents),
        updated_at      = now()
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_vehicle_classes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_vehicle_classes() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_set_vehicle_class(text, text, text, text, integer, text, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_vehicle_class(text, text, text, text, integer, text, boolean, integer, integer) TO authenticated;

-- ─── 3. P0 fix: case-insensitive matching in claim_available_driver ──
CREATE OR REPLACE FUNCTION public.claim_available_driver(
    p_pickup_lat double precision,
    p_pickup_lng double precision,
    p_vehicle_type text,
    p_rider_id uuid,
    p_max_distance_km double precision DEFAULT 15,
    p_candidate_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(driver_id uuid, driver_name text, distance_km double precision, composite_score double precision)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  WEIGHT_DISTANCE CONSTANT float := 0.70;
  WEIGHT_ACCEPT   CONSTANT float := 0.30;
  v_driver_id uuid;
BEGIN
  -- Pick highest-scoring eligible driver. LEAST(1.0, ...) guards acos() domain
  -- (a driver exactly at pickup can produce a value marginally above 1.0).
  WITH candidates AS (
    SELECT
      d.id,
      6371 * acos(LEAST(1.0,
        cos(radians(p_pickup_lat)) * cos(radians(d.lat)) *
        cos(radians(d.lng) - radians(p_pickup_lng)) +
        sin(radians(p_pickup_lat)) * sin(radians(d.lat))
      )) AS dist_km,
      COALESCE(d.acceptance_rate, 0.80) AS acc
    FROM drivers d
    WHERE d.is_online = true
      AND d.is_verified = true
      AND d.active_ride_id IS NULL
      AND (p_candidate_ids IS NULL OR d.id = ANY(p_candidate_ids))
      AND (lower(p_vehicle_type) = 'any' OR lower(d.vehicle_type) = lower(p_vehicle_type))
      AND NOT EXISTS (
        SELECT 1 FROM blacklists b
        WHERE (b.user_id = p_rider_id AND b.blocked_user_id = d.user_id)
           OR (b.user_id = d.user_id AND b.blocked_user_id = p_rider_id)
      )
  )
  SELECT c.id INTO v_driver_id
  FROM candidates c
  WHERE (p_candidate_ids IS NOT NULL) OR (c.dist_km <= p_max_distance_km)
  ORDER BY (
    WEIGHT_DISTANCE * (1.0 - LEAST(c.dist_km / NULLIF(p_max_distance_km, 0), 1.0)) +
    WEIGHT_ACCEPT   * c.acc
  ) DESC
  LIMIT 1;

  IF v_driver_id IS NULL THEN
    RETURN;
  END IF;

  -- Atomically lock the chosen driver; if another dispatch already holds the
  -- lock, skip (caller re-queues) — eliminates double-dispatch.
  PERFORM 1 FROM drivers WHERE id = v_driver_id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    d.id,
    d.name,
    6371 * acos(LEAST(1.0,
      cos(radians(p_pickup_lat)) * cos(radians(d.lat)) *
      cos(radians(d.lng) - radians(p_pickup_lng)) +
      sin(radians(p_pickup_lat)) * sin(radians(d.lat))
    )) AS distance_km,
    WEIGHT_DISTANCE * (1.0 - LEAST(
      (6371 * acos(LEAST(1.0,
        cos(radians(p_pickup_lat)) * cos(radians(d.lat)) *
        cos(radians(d.lng) - radians(p_pickup_lng)) +
        sin(radians(p_pickup_lat)) * sin(radians(d.lat))
      ))) / NULLIF(p_max_distance_km, 0), 1.0)) +
    WEIGHT_ACCEPT * COALESCE(d.acceptance_rate, 0.80) AS composite_score
  FROM drivers d WHERE d.id = v_driver_id;
END;
$function$;

-- ─── 4. Normalize existing driver rows to canonical lowercase ────────
UPDATE public.drivers
SET vehicle_type = lower(vehicle_type)
WHERE vehicle_type <> lower(vehicle_type);

-- ─── 5. PostgREST must see the new table + RPCs immediately ──────────
NOTIFY pgrst, 'reload schema';
