-- G-TAXI HARDENING: Fix 7 - Forced App Update & Maintenance Mode
-- Infrastructure to enforce app versions and global maintenance.

-- 1. Create system_config table
CREATE TABLE IF NOT EXISTS public.system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. RLS Policies
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read system config" ON public.system_config;
CREATE POLICY "Anyone can read system config" ON public.system_config FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role manages system config" ON public.system_config;
CREATE POLICY "Service role manages system config" ON public.system_config FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. Initial Configuration
INSERT INTO public.system_config (key, value, description) VALUES
    ('min_version_rider', '1.0.0', 'Minimum required version for Rider app'),
    ('min_version_driver', '1.0.0', 'Minimum required version for Driver app'),
    ('maintenance_mode', 'false', 'Set to "true" to block all app activity with a maintenance screen')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
