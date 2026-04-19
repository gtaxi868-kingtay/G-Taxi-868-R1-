-- Migration: vertical_settings
-- Phase 4 Fix: Admin-controlled feature flags for vertical expansion (Gojek/Grab model)
-- Market evidence: Gojek has 20+ services, cross-sell increases LTV 3-4x

-- 1. Create vertical settings table for admin-controlled rollout
CREATE TABLE IF NOT EXISTS vertical_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vertical_name TEXT UNIQUE NOT NULL, -- 'laundry', 'grocery', 'delivery', 'merchant'
    display_name TEXT NOT NULL,
    is_enabled BOOLEAN DEFAULT false,
    enabled_regions TEXT[] DEFAULT '{}', -- e.g., ['POS', 'SFO', 'Chaguanas']
    requires_subscription BOOLEAN DEFAULT false,
    min_subscription_tier TEXT DEFAULT 'free',
    commission_rate_percent INTEGER DEFAULT 15,
    driver_commission_percent INTEGER DEFAULT 81,
    icon_name TEXT DEFAULT 'apps',
    sort_order INTEGER DEFAULT 0,
    config JSONB DEFAULT '{}'::jsonb, -- vertical-specific settings
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    enabled_by UUID REFERENCES auth.users(id),
    rollout_percentage INTEGER DEFAULT 0 -- 0-100 for gradual rollout
);

-- 2. Enable RLS
ALTER TABLE vertical_settings ENABLE ROW LEVEL SECURITY;

-- 3. RLS: Create policies with existence check
DO $$
BEGIN
    -- Public read policy
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'vertical_settings' 
        AND policyname = 'Allow public read of enabled verticals'
    ) THEN
        CREATE POLICY "Allow public read of enabled verticals"
        ON vertical_settings FOR SELECT
        TO public
        USING (is_enabled = true);
    END IF;

    -- Admin modify policy
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'vertical_settings' 
        AND policyname = 'Allow admin modify'
    ) THEN
        CREATE POLICY "Allow admin modify"
        ON vertical_settings FOR ALL
        TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM profiles 
                WHERE id = auth.uid() 
                AND (is_admin = true OR role = 'admin')
            )
        );
    END IF;
END $$;

-- 5. Create function to check if vertical is enabled for user
CREATE OR REPLACE FUNCTION is_vertical_enabled(
    p_vertical_name TEXT,
    p_user_id UUID DEFAULT NULL,
    p_region TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    v_vertical RECORD;
    v_user_tier TEXT;
    v_user_in_rollout BOOLEAN;
BEGIN
    -- Get vertical settings
    SELECT * INTO v_vertical
    FROM vertical_settings
    WHERE vertical_name = p_vertical_name;
    
    -- Not found = disabled
    IF NOT FOUND THEN
        RETURN false;
    END IF;
    
    -- Globally disabled
    IF NOT v_vertical.is_enabled THEN
        RETURN false;
    END IF;
    
    -- Check region restriction
    IF array_length(v_vertical.enabled_regions, 1) > 0 AND p_region IS NOT NULL THEN
        IF NOT (p_region = ANY(v_vertical.enabled_regions)) THEN
            RETURN false;
        END IF;
    END IF;
    
    -- Check subscription requirement
    IF v_vertical.requires_subscription THEN
        SELECT subscription_tier INTO v_user_tier
        FROM profiles
        WHERE id = COALESCE(p_user_id, auth.uid());
        
        IF v_user_tier IS NULL OR v_user_tier < v_vertical.min_subscription_tier THEN
            RETURN false;
        END IF;
    END IF;
    
    -- Check rollout percentage (deterministic based on user_id)
    IF v_vertical.rollout_percentage < 100 THEN
        v_user_in_rollout := (
            extract(epoch from auth.uid()::text::uuid)::bigint % 100
        ) < v_vertical.rollout_percentage;
        
        IF NOT v_user_in_rollout THEN
            RETURN false;
        END IF;
    END IF;
    
    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Seed default verticals (all disabled by default)
INSERT INTO vertical_settings (
    vertical_name, display_name, is_enabled, enabled_regions, 
    requires_subscription, commission_rate_percent, icon_name, sort_order, config
) VALUES 
    ('ride_hailing', 'G-Taxi Rides', true, ARRAY['POS', 'SFO', 'Chaguanas', 'San Fernando'], false, 19, 'car', 1, '{"base_enabled": true}'::jsonb),
    ('laundry', 'Laundry Pickup', false, '{}', false, 20, 'shirt', 2, '{"max_items_per_pickup": 20, "handoff_required": true}'::jsonb),
    ('grocery', 'Grocery Delivery', false, '{}', false, 15, 'cart', 3, '{"partner_stores": ["Massy", "Xtra Foods"]}'::jsonb),
    ('merchant_delivery', 'Merchant Delivery', false, '{}', true, 15, 'cube', 4, '{"min_subscription_tier": "plus"}'::jsonb),
    ('b2b_logistics', 'Business Logistics', false, '{}', true, 12, 'business', 5, '{"min_subscription_tier": "pro", "contract_required": true}'::jsonb)
ON CONFLICT (vertical_name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    commission_rate_percent = EXCLUDED.commission_rate_percent,
    icon_name = EXCLUDED.icon_name,
    sort_order = EXCLUDED.sort_order;

-- 7. Create index for vertical lookups
CREATE INDEX IF NOT EXISTS idx_vertical_enabled 
ON vertical_settings(is_enabled, sort_order) 
WHERE is_enabled = true;

CREATE INDEX IF NOT EXISTS idx_vertical_regions 
ON vertical_settings USING GIN(enabled_regions) 
WHERE is_enabled = true;

-- 8. Create function to get enabled verticals for a user
CREATE OR REPLACE FUNCTION get_enabled_verticals(
    p_user_id UUID DEFAULT NULL,
    p_region TEXT DEFAULT NULL
) RETURNS TABLE (
    vertical_name TEXT,
    display_name TEXT,
    icon_name TEXT,
    sort_order INTEGER,
    config JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        vs.vertical_name,
        vs.display_name,
        vs.icon_name,
        vs.sort_order,
        vs.config
    FROM vertical_settings vs
    WHERE vs.is_enabled = true
      AND (array_length(vs.enabled_regions, 1) = 0 OR p_region = ANY(vs.enabled_regions))
      AND (
          NOT vs.requires_subscription 
          OR EXISTS (
              SELECT 1 FROM profiles p 
              WHERE p.id = COALESCE(p_user_id, auth.uid())
              AND p.subscription_tier >= vs.min_subscription_tier
          )
      )
      AND (
          vs.rollout_percentage = 100
          OR (extract(epoch from COALESCE(p_user_id, auth.uid())::text::uuid)::bigint % 100) < vs.rollout_percentage
      )
    ORDER BY vs.sort_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. Create updated_at trigger
CREATE OR REPLACE FUNCTION update_vertical_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'verticals_updated_at'
    ) THEN
        CREATE TRIGGER verticals_updated_at
        BEFORE UPDATE ON vertical_settings
        FOR EACH ROW
        EXECUTE FUNCTION update_vertical_timestamp();
    END IF;
END $$;

-- Notify schema cache update
NOTIFY pgrst, 'reload schema';
