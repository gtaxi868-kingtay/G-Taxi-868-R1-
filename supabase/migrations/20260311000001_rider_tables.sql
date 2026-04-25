-- Master Fix Part 3: Missing Rider Enhancements (Gap 13)
-- These tables are queried by the UI but do not exist in the database.

-- 1. Saved Places
CREATE TABLE IF NOT EXISTS public.saved_places (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    label TEXT NOT NULL, -- e.g. "Home", "Work", "Gym"
    address TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    icon TEXT, -- e.g. "🏠"
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
-- Enable RLS for saved_places
ALTER TABLE public.saved_places ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own saved places"
ON public.saved_places FOR ALL
TO authenticated
USING (auth.uid() = user_id);
-- 2. Promo Codes System
CREATE TABLE IF NOT EXISTS public.admin_promos (
    code TEXT PRIMARY KEY,
    description TEXT,
    discount_percent INTEGER CHECK (discount_percent >= 1 AND discount_percent <= 100),
    max_uses INTEGER DEFAULT 100,
    current_uses INTEGER DEFAULT 0,
    expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
-- Promos claimed by users
CREATE TABLE IF NOT EXISTS public.user_promos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    promo_code TEXT NOT NULL REFERENCES public.admin_promos(code) ON DELETE CASCADE,
    is_used BOOLEAN DEFAULT false,
    claimed_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(user_id, promo_code)
);
-- Enable RLS for promos
ALTER TABLE public.admin_promos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_promos ENABLE ROW LEVEL SECURITY;
-- Reading global promos (anyone authenticated can see active ones, but Admin manages)
CREATE POLICY "Anyone can view active promos"
ON public.admin_promos FOR SELECT
TO authenticated
USING (is_active = true AND (expires_at IS NULL OR expires_at > now()));
CREATE POLICY "Admins manage promos"
ON public.admin_promos FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));
-- User Promos
CREATE POLICY "Users view and claim their own promos"
ON public.user_promos FOR ALL
TO authenticated
USING (auth.uid() = user_id);
-- Seed a welcome promo
INSERT INTO public.admin_promos (code, description, discount_percent, expires_at)
VALUES ('WELCOME20', 'Get 20% off your first ride!', 20, now() + interval '1 year')
ON CONFLICT (code) DO NOTHING;
