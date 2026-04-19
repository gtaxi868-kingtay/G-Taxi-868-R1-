-- Phase 12: Deep AI & Merchant Foundation

-- 1. Rider AI Preferences
CREATE TABLE IF NOT EXISTS public.rider_ai_preferences (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    quiet_ride BOOLEAN DEFAULT false,
    pace_priority TEXT DEFAULT 'balanced', -- 'speed', 'cost', 'balanced'
    route_avoidance TEXT[] DEFAULT '{}',
    ai_suggestions_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Driver AI Strategy
CREATE TABLE IF NOT EXISTS public.driver_ai_strategy (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    strategy_mode TEXT DEFAULT 'stable', -- 'hustler', 'closer', 'stable'
    max_distance_meters INTEGER DEFAULT 10000,
    preferred_neighborhoods TEXT[] DEFAULT '{}',
    fatigue_alerts_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Merchants (Groceries/Laundry Foundation)
CREATE TABLE IF NOT EXISTS public.merchants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    category TEXT NOT NULL, -- 'grocery', 'laundry', 'pharmacy'
    address TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    is_active BOOLEAN DEFAULT true,
    commission_rate NUMERIC DEFAULT 0.05,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Products (Basic Inventory)
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID REFERENCES public.merchants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    description TEXT,
    is_available BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Add New System Feature Flags for Service Management
INSERT INTO public.system_feature_flags (id, is_active, description) VALUES
    ('grocery_active', false, 'Controls visibility of the Grocery service tile for riders.'),
    ('laundry_active', false, 'Controls visibility of the Laundry service tile for riders.'),
    ('ai_assistant_active', false, 'Enables the AI concierge and predictive suggestions.'),
    ('merchant_commission_enabled', true, 'Toggles the platform fee for merchant sales.')
ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description;

-- Enable RLS
ALTER TABLE public.rider_ai_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_ai_strategy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- RLS Policies (with existence checks)
DO $$
BEGIN
    -- Rider AI preferences policy
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'rider_ai_preferences' 
        AND policyname = 'Riders can manage their own AI preferences'
    ) THEN
        CREATE POLICY "Riders can manage their own AI preferences"
            ON public.rider_ai_preferences FOR ALL
            USING (auth.uid() = user_id);
    END IF;

    -- Driver AI strategy policy
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'driver_ai_strategy' 
        AND policyname = 'Drivers can manage their own AI strategy'
    ) THEN
        CREATE POLICY "Drivers can manage their own AI strategy"
            ON public.driver_ai_strategy FOR ALL
            USING (auth.uid() = user_id);
    END IF;

    -- Merchants view policy
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'merchants' 
        AND policyname = 'Everyone can view active merchants'
    ) THEN
        CREATE POLICY "Everyone can view active merchants"
            ON public.merchants FOR SELECT
            USING (is_active = true);
    END IF;

    -- Products view policy
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'products' 
        AND policyname = 'Everyone can view available products'
    ) THEN
        CREATE POLICY "Everyone can view available products"
            ON public.products FOR SELECT
            USING (is_available = true);
    END IF;
END $$;
