-- 12. Profile System (Strict Uber-Aligned Architecture)
-- Implements compliance, preferences, and settings tables.

-- ============================================
-- 1. ENHANCE PROFILES TABLE
-- ============================================
-- Ensure all required Identity fields exist
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

-- Sync email from auth.users if missing (Utility)
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id
AND p.email IS NULL;

-- ============================================
-- 2. USER PREFERENCES (RIDE DEFAULTS)
-- ============================================
CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  preferred_vehicle_type TEXT DEFAULT 'Standard',
  preferred_payment_method TEXT DEFAULT 'cash',
  favorite_driver_ids UUID[] DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_preferences' AND policyname = 'Users can view own preferences') THEN
        CREATE POLICY "Users can view own preferences" ON public.user_preferences FOR SELECT USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_preferences' AND policyname = 'Users can update own preferences') THEN
        CREATE POLICY "Users can update own preferences" ON public.user_preferences FOR UPDATE USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_preferences' AND policyname = 'Users can insert own preferences') THEN
        CREATE POLICY "Users can insert own preferences" ON public.user_preferences FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

-- ============================================
-- 3. NOTIFICATION SETTINGS (COMPLIANCE)
-- ============================================
CREATE TABLE IF NOT EXISTS public.notification_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ride_updates BOOLEAN DEFAULT true,
  promotions BOOLEAN DEFAULT true,
  service_alerts BOOLEAN DEFAULT true, -- Forced true in UI, but boolean here
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notification_settings' AND policyname = 'Users can view own settings') THEN
        CREATE POLICY "Users can view own settings" ON public.notification_settings FOR SELECT USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notification_settings' AND policyname = 'Users can update own settings') THEN
        CREATE POLICY "Users can update own settings" ON public.notification_settings FOR UPDATE USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notification_settings' AND policyname = 'Users can insert own settings') THEN
        CREATE POLICY "Users can insert own settings" ON public.notification_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;


-- ============================================
-- 4. UTILITY TRIGGER: CREATE DEFAULTS ON SIGNUP
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user_profile_defaults()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert Preferences Default
  INSERT INTO public.user_preferences (user_id) VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  -- Insert Notification Defaults
  INSERT INTO public.notification_settings (user_id) VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Hook into auth.users creation (or existing profiles trigger if easier, 
-- but separate is safer for modularity)
CREATE OR REPLACE TRIGGER on_auth_user_created_defaults
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_profile_defaults();

-- Backfill for existing users who might have missed the trigger
INSERT INTO public.user_preferences (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.notification_settings (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;
