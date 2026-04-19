-- Migration: rider_subscriptions
-- Phase 4 Fix: Subscription tier system for riders (Uber One/Lyft Pink model)
-- Market evidence: Uber One has 30M members, 60% YoY growth, members spend 3x more

-- 1. Create subscription tier enum
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rider_subscription_tier') THEN
        CREATE TYPE rider_subscription_tier AS ENUM ('free', 'plus', 'pro');
    END IF;
END $$;

-- 2. Add subscription columns to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS subscription_tier rider_subscription_tier DEFAULT 'free',
ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMP WITH TIME ZONE;

-- 3. Create subscription benefits table
CREATE TABLE IF NOT EXISTS subscription_benefits (
    tier rider_subscription_tier PRIMARY KEY,
    discount_percent INTEGER DEFAULT 0,
    priority_matching BOOLEAN DEFAULT false,
    free_wait_minutes INTEGER DEFAULT 3, -- extends grace period
    monthly_price_cents INTEGER,
    yearly_price_cents INTEGER,
    description TEXT,
    features JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Enable RLS on subscription_benefits
ALTER TABLE subscription_benefits ENABLE ROW LEVEL SECURITY;

-- 5. RLS: Create policies with existence check
DO $$
BEGIN
    -- Policy for subscription benefits
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'subscription_benefits' 
        AND policyname = 'Allow public read of subscription benefits'
    ) THEN
        CREATE POLICY "Allow public read of subscription benefits"
        ON subscription_benefits FOR SELECT
        TO public
        USING (true);
    END IF;

    -- Policy for profiles (subscription tier access)
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'profiles' 
        AND policyname = 'Allow users to read own subscription tier'
    ) THEN
        CREATE POLICY "Allow users to read own subscription tier"
        ON profiles FOR SELECT
        TO authenticated
        USING (auth.uid() = id);
    END IF;
END $$;

-- 7. Seed default benefits (Trinidad market pricing)
INSERT INTO subscription_benefits (tier, discount_percent, priority_matching, free_wait_minutes, monthly_price_cents, yearly_price_cents, description, features)
VALUES 
    ('free', 0, false, 3, 0, 0, 'Basic ride access with standard features', '["Standard matching", "3-minute wait grace", "Email support"]'::jsonb),
    ('plus', 10, false, 5, 999, 9999, 'Frequent rider perks with 10% discount', '["10% ride discount", "Priority support", "5-minute wait grace", "No surge pricing (up to 1.5x)"]'::jsonb),
    ('pro', 15, true, 10, 1999, 19999, 'Premium experience with 15% discount', '["15% ride discount", "Priority matching", "10-minute wait grace", "No surge pricing", "Premium vehicle access", "Dedicated support"]'::jsonb)
ON CONFLICT (tier) DO UPDATE SET
    discount_percent = EXCLUDED.discount_percent,
    priority_matching = EXCLUDED.priority_matching,
    free_wait_minutes = EXCLUDED.free_wait_minutes,
    monthly_price_cents = EXCLUDED.monthly_price_cents,
    yearly_price_cents = EXCLUDED.yearly_price_cents,
    description = EXCLUDED.description,
    features = EXCLUDED.features;

-- 8. Create function to calculate subscription discount
CREATE OR REPLACE FUNCTION calculate_subscription_discount(
    p_user_id UUID,
    p_base_fare_cents INTEGER
) RETURNS INTEGER AS $$
DECLARE
    v_tier rider_subscription_tier;
    v_discount_percent INTEGER;
    v_min_discount_cents INTEGER;
BEGIN
    -- Get user's tier
    SELECT subscription_tier INTO v_tier
    FROM profiles
    WHERE id = p_user_id;
    
    -- Default to free
    v_tier := COALESCE(v_tier, 'free');
    
    -- Get discount percent
    SELECT discount_percent INTO v_discount_percent
    FROM subscription_benefits
    WHERE tier = v_tier;
    
    -- Minimum discounts per tier
    v_min_discount_cents := CASE v_tier
        WHEN 'free' THEN 0
        WHEN 'plus' THEN 50  -- $0.50 minimum
        WHEN 'pro' THEN 100  -- $1.00 minimum
    END;
    
    -- Calculate and return discount (capped at reasonable max)
    RETURN GREATEST(v_min_discount_cents, LEAST((p_base_fare_cents * v_discount_percent / 100), 5000));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. Create index for subscription lookups
CREATE INDEX IF NOT EXISTS idx_profiles_subscription 
ON profiles(subscription_tier) 
WHERE subscription_tier != 'free';

-- Notify schema cache update
NOTIFY pgrst, 'reload schema';
