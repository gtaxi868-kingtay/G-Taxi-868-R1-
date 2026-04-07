-- Migration: 20260405020000_security_lockdown
-- Purpose: Hardening RLS on discovered vulnerable tables

-- 1. order_handoff_pins
ALTER TABLE public.order_handoff_pins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own order pins" ON public.order_handoff_pins;
CREATE POLICY "Users can read their own order pins" 
ON public.order_handoff_pins
FOR SELECT 
USING (
  auth.uid() IN (
    SELECT rider_id FROM public.orders WHERE id = order_id
    UNION
    SELECT driver_id FROM public.rides WHERE id = (SELECT ride_id FROM public.orders WHERE id = order_id)
  )
);

-- 2. stripe_config
ALTER TABLE public.stripe_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Only service role can access stripe_config" ON public.stripe_config;
-- No public/authenticated policies means only service_role (Admin) can access it. 
-- This is intentionally restrictive.

-- 3. system_features
ALTER TABLE public.system_features ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read system_features" ON public.system_features;
CREATE POLICY "Anyone can read system_features" 
ON public.system_features FOR SELECT 
TO authenticated 
USING (true);

DROP POLICY IF EXISTS "Only admins can update system_features" ON public.system_features;
-- Admins handled by service_role or future admin role policy.

-- 4. user_memories
ALTER TABLE public.user_memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own memories" ON public.user_memories;
CREATE POLICY "Users can manage their own memories" 
ON public.user_memories
FOR ALL 
USING (auth.uid() = user_id);

-- 5. user_preferred_drivers
ALTER TABLE public.user_preferred_drivers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their preferred drivers" ON public.user_preferred_drivers;
CREATE POLICY "Users can manage_preferred_drivers" 
ON public.user_preferred_drivers
FOR ALL 
USING (auth.uid() = user_id);
