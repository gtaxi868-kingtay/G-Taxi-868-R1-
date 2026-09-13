-- PHASE 2 — a hard leash on surge pricing.
--
-- THE BACKSTOP FIRST. pricing_zones.multiplier had NO check constraint, so any
-- code path — AI, admin screen, stray script — could write any number at all.
ALTER TABLE public.pricing_zones
  ADD CONSTRAINT pricing_zones_multiplier_sane
  CHECK (multiplier >= 1.0 AND multiplier <= 2.0);

COMMENT ON CONSTRAINT pricing_zones_multiplier_sane ON public.pricing_zones IS
'Hard cap on surge. The AI prompt merely SUGGESTS min(demand*0.8, 2.0); a prompt is not a control. This constraint is. Do not widen without a deliberate pricing decision.';

-- admin_set_surge_zone could never have worked. FIVE independent defects, every
-- one inside its single INSERT:
--   1. wrote surge_multiplier — the real column is `multiplier`
--   2. wrote radius_km        — the real column is `radius_meters`
--   3. omitted boundary_geojson, which is NOT NULL
--   4. ON CONFLICT (name) with no unique index on name
--   5. format('%.1fx') — Postgres format() rejects printf float specifiers,
--      the exact trap already recorded in CLAUDE.md
--
-- So the P0 this phase set out to fix — "the AI can set 5x surge" — was never
-- reachable: the call died before touching a row. The real finding is that
-- surge pricing has NEVER worked, for the AI or for an admin via WarChest.tsx.
-- estimate_fare was unaffected: it falls back to a direct query using the
-- correct column names, so fares were always right and surge simply never
-- applied.
--
-- Now guarded twice: an explicit range check inside the function (clear error)
-- and the table constraint above (catches anything bypassing the function).
--
-- Admin guard is now `auth.uid() IS NOT NULL AND role <> 'admin'`. The NULL arm
-- is deliberate so service_role/cron callers work; previously a service-role
-- call was rejected outright because auth.uid() is NULL there.
CREATE UNIQUE INDEX IF NOT EXISTS pricing_zones_name_key ON public.pricing_zones (name);

CREATE OR REPLACE FUNCTION public.admin_set_surge_zone(
    p_lat double precision, p_lng double precision, p_radius_km double precision,
    p_multiplier numeric, p_expires_at timestamp with time zone DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_id UUID;
BEGIN
    IF auth.uid() IS NOT NULL
       AND (SELECT role::text FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Unauthorized: admin role required';
    END IF;
    IF p_multiplier IS NULL OR p_multiplier < 1.0 OR p_multiplier > 2.0 THEN
        RAISE EXCEPTION 'Surge multiplier must be between 1.0 and 2.0 (got %)', p_multiplier;
    END IF;
    INSERT INTO pricing_zones (name, boundary_geojson, center_lat, center_lng, radius_meters,
                               multiplier, is_active, expires_at, created_at)
    VALUES (format('Auto surge %sx @ %s,%s', round(p_multiplier,1),
                   round(p_lat::numeric,4), round(p_lng::numeric,4)),
            jsonb_build_object('type','Point','coordinates', jsonb_build_array(p_lng, p_lat)),
            p_lat, p_lng, (p_radius_km * 1000)::integer,
            p_multiplier, true,
            COALESCE(p_expires_at, now() + interval '2 hours'), now())
    ON CONFLICT (name) DO UPDATE
        SET multiplier = EXCLUDED.multiplier, is_active = true, expires_at = EXCLUDED.expires_at
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$function$;
