-- Migration: 20260616000000_pricing_config_and_admin_rpcs.sql
-- Creates pricing_config table so admin can change fare rates live,
-- plus the 5 admin RPCs called by apps/admin/src/pages/Pricing.tsx
-- that were previously missing (causing the page to error on load).

BEGIN;

-- ── 1. pricing_config table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pricing_config (
    key         TEXT PRIMARY KEY,
    value_cents INTEGER NOT NULL CHECK (value_cents >= 0),
    description TEXT NOT NULL DEFAULT '',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pricing_config ENABLE ROW LEVEL SECURITY;

-- Admins can read and write; everyone else is locked out.
CREATE POLICY "Admin full access pricing_config"
    ON public.pricing_config
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- Seed with current hardcoded values from _shared/pricing.ts
-- so the admin page shows the real numbers on first load.
INSERT INTO public.pricing_config (key, value_cents, description) VALUES
    ('BASE_FARE_CENTS', 1600,  'Flat charge at start of every ride (TTD ×100)'),
    ('PER_KM_CENTS',    175,   'Rate per kilometre of route distance (TTD ×100)'),
    ('PER_MIN_CENTS',   95,    'Rate per minute while trip is active (TTD ×100)'),
    ('MIN_FARE_CENTS',  2200,  'Floor — no ride can cost less than this (TTD ×100)')
ON CONFLICT (key) DO UPDATE
    SET value_cents = EXCLUDED.value_cents,
        description = EXCLUDED.description,
        updated_at  = now();

-- ── 2. admin_get_pricing ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_pricing()
RETURNS TABLE (key TEXT, value_cents INTEGER, description TEXT)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT key, value_cents, description
    FROM public.pricing_config
    ORDER BY key;
$$;

REVOKE ALL ON FUNCTION public.admin_get_pricing() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_pricing() TO service_role, authenticated;

-- ── 3. admin_set_pricing ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_pricing(p_key TEXT, p_value_cents INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    IF p_value_cents < 0 THEN
        RAISE EXCEPTION 'value_cents must be >= 0';
    END IF;

    INSERT INTO public.pricing_config (key, value_cents, updated_at)
    VALUES (p_key, p_value_cents, now())
    ON CONFLICT (key) DO UPDATE
        SET value_cents = EXCLUDED.value_cents,
            updated_at  = now();
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_pricing(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_pricing(TEXT, INTEGER) TO service_role, authenticated;

-- ── 4. admin_get_surge_zones ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_surge_zones()
RETURNS TABLE (
    id             UUID,
    name           TEXT,
    center_lat     NUMERIC,
    center_lng     NUMERIC,
    radius_meters  INTEGER,
    multiplier     NUMERIC,
    reason         TEXT,
    expires_at     TIMESTAMPTZ,
    is_active      BOOLEAN,
    created_at     TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT
        id, name, center_lat, center_lng, radius_meters,
        multiplier, reason, expires_at, is_active, created_at
    FROM public.pricing_zones
    ORDER BY created_at DESC
    LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.admin_get_surge_zones() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_surge_zones() TO service_role, authenticated;

-- ── 5. admin_deactivate_surge_zone ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_deactivate_surge_zone(p_zone_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    UPDATE public.pricing_zones
    SET is_active = false, updated_at = now()
    WHERE id = p_zone_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_deactivate_surge_zone(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_deactivate_surge_zone(UUID) TO service_role, authenticated;

-- ── 6. admin_create_surge_zone ───────────────────────────────────────────────
-- Pricing.tsx calls admin_create_surge_zone with these exact args;
-- admin_set_surge_zone exists but has a different signature (no reason param).
CREATE OR REPLACE FUNCTION public.admin_create_surge_zone(
    p_lat        DOUBLE PRECISION,
    p_lng        DOUBLE PRECISION,
    p_radius_m   INTEGER,
    p_multiplier NUMERIC,
    p_reason     TEXT,
    p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id UUID;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    IF p_multiplier < 1.0 OR p_multiplier > 5.0 THEN
        RAISE EXCEPTION 'multiplier must be between 1.0 and 5.0';
    END IF;

    INSERT INTO public.pricing_zones (
        name,
        boundary_geojson,
        multiplier,
        is_active,
        center_lat,
        center_lng,
        radius_meters,
        reason,
        expires_at
    ) VALUES (
        p_reason,
        '{"type":"Point"}'::jsonb,
        p_multiplier,
        true,
        p_lat,
        p_lng,
        p_radius_m,
        p_reason,
        p_expires_at
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_surge_zone(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, NUMERIC, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_surge_zone(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, NUMERIC, TEXT, TIMESTAMPTZ) TO service_role, authenticated;

COMMIT;
