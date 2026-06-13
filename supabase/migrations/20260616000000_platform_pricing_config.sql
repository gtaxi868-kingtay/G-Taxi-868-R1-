-- Platform pricing config + surge zone RPCs + product catalog columns
-- 2026-06-16

-- ── 1. platform_config table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_config (
    key         TEXT PRIMARY KEY,
    value_cents INTEGER NOT NULL,
    description TEXT,
    updated_at  TIMESTAMPTZ DEFAULT now(),
    updated_by  UUID REFERENCES auth.users(id)
);

INSERT INTO platform_config (key, value_cents, description) VALUES
    ('BASE_FARE_CENTS', 1600, 'Base fare in TTD cents (default: $16.00)'),
    ('PER_KM_CENTS',     175, 'Per kilometre rate in TTD cents (default: $1.75)'),
    ('PER_MIN_CENTS',     95, 'Per minute rate in TTD cents (default: $0.95)'),
    ('MIN_FARE_CENTS',  2200, 'Minimum fare in TTD cents (default: $22.00)')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE platform_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_select_platform_config" ON platform_config
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- Service role bypasses RLS automatically in Supabase.

-- ── 2. admin_get_pricing RPC ──────────────────────────────────────────────────
DROP FUNCTION IF EXISTS admin_get_pricing();
CREATE OR REPLACE FUNCTION admin_get_pricing()
RETURNS TABLE(key TEXT, value_cents INTEGER, description TEXT, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;
    RETURN QUERY
        SELECT pc.key, pc.value_cents, pc.description, pc.updated_at
        FROM platform_config pc
        ORDER BY pc.key;
END;
$$;

-- ── 3. admin_set_pricing RPC ──────────────────────────────────────────────────
DROP FUNCTION IF EXISTS admin_set_pricing(TEXT, INTEGER);
CREATE OR REPLACE FUNCTION admin_set_pricing(p_key TEXT, p_value_cents INTEGER)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;
    IF p_key NOT IN ('BASE_FARE_CENTS', 'PER_KM_CENTS', 'PER_MIN_CENTS', 'MIN_FARE_CENTS') THEN
        RAISE EXCEPTION 'Invalid pricing key: %', p_key;
    END IF;
    IF p_value_cents < 1 OR p_value_cents > 200000 THEN
        RAISE EXCEPTION 'Value must be between 1 and 200000 cents';
    END IF;
    UPDATE platform_config
       SET value_cents = p_value_cents,
           updated_at  = now(),
           updated_by  = auth.uid()
     WHERE key = p_key;
END;
$$;

-- ── 4. admin_get_surge_zones RPC ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS admin_get_surge_zones();
CREATE OR REPLACE FUNCTION admin_get_surge_zones()
RETURNS TABLE(
    id          UUID,
    center_lat  DOUBLE PRECISION,
    center_lng  DOUBLE PRECISION,
    radius_meters INTEGER,
    multiplier  NUMERIC,
    reason      TEXT,
    expires_at  TIMESTAMPTZ,
    is_active   BOOLEAN,
    created_at  TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;
    RETURN QUERY
        SELECT pz.id,
               pz.center_lat::DOUBLE PRECISION,
               pz.center_lng::DOUBLE PRECISION,
               pz.radius_meters::INTEGER,
               pz.multiplier,
               pz.reason,
               pz.expires_at,
               pz.is_active,
               pz.created_at
          FROM pricing_zones pz
         WHERE pz.is_active = true
           AND (pz.expires_at IS NULL OR pz.expires_at > now())
         ORDER BY pz.created_at DESC;
END;
$$;

-- ── 5. admin_create_surge_zone RPC ───────────────────────────────────────────
DROP FUNCTION IF EXISTS admin_create_surge_zone(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, NUMERIC, TEXT, TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION admin_create_surge_zone(
    p_lat        DOUBLE PRECISION,
    p_lng        DOUBLE PRECISION,
    p_radius_m   INTEGER,
    p_multiplier NUMERIC,
    p_reason     TEXT,
    p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_id UUID;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;
    IF p_multiplier < 1.0 OR p_multiplier > 5.0 THEN
        RAISE EXCEPTION 'Multiplier must be 1.0–5.0';
    END IF;
    IF p_radius_m < 100 OR p_radius_m > 50000 THEN
        RAISE EXCEPTION 'Radius must be 100m–50km';
    END IF;
    INSERT INTO pricing_zones (center_lat, center_lng, radius_meters, multiplier, reason, expires_at, is_active, created_by)
    VALUES (p_lat, p_lng, p_radius_m, p_multiplier, p_reason, p_expires_at, true, auth.uid())
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- ── 6. admin_deactivate_surge_zone RPC ───────────────────────────────────────
DROP FUNCTION IF EXISTS admin_deactivate_surge_zone(UUID);
CREATE OR REPLACE FUNCTION admin_deactivate_surge_zone(p_zone_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;
    UPDATE pricing_zones SET is_active = false WHERE id = p_zone_id;
END;
$$;

-- ── 7. Product catalog columns ────────────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS category   TEXT    DEFAULT 'general';
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url  TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_products_merchant_category
    ON products(merchant_id, category) WHERE is_available = true;

-- Merchants (owner or staff) can manage their own products
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE tablename = 'products'
           AND policyname = 'merchants_manage_own_products'
    ) THEN
        EXECUTE $policy$
            CREATE POLICY "merchants_manage_own_products" ON products
                FOR ALL USING (
                    merchant_id IN (
                        SELECT m.id FROM merchants m WHERE m.created_by = auth.uid()
                        UNION
                        SELECT ms.merchant_id FROM merchant_staff ms WHERE ms.user_id = auth.uid()
                    )
                )
                WITH CHECK (
                    merchant_id IN (
                        SELECT m.id FROM merchants m WHERE m.created_by = auth.uid()
                        UNION
                        SELECT ms.merchant_id FROM merchant_staff ms WHERE ms.user_id = auth.uid()
                    )
                )
        $policy$;
    END IF;
END;
$$;
