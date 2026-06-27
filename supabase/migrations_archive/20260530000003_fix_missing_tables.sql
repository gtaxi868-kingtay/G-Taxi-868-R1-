-- =============================================================================
-- 6-STEP STABILIZATION — Step 1: Fix Missing Tables
-- Creates 3 tables that apps reference but don't exist in schema.
-- Sources: migrations_archive/012_profile_system.sql (user_preferences,
--   notification_settings) + rider_preferences (new).
-- =============================================================================

-- 1. USER PREFERENCES — referenced by AuthContext.tsx:102
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

-- 2. NOTIFICATION SETTINGS — referenced by SettingsScreen.tsx:41,62
CREATE TABLE IF NOT EXISTS public.notification_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ride_updates BOOLEAN DEFAULT true,
  promotions BOOLEAN DEFAULT true,
  service_alerts BOOLEAN DEFAULT true,
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

-- 3. RIDER PREFERENCES — referenced by TripRequestScreen.tsx:121 (no schema existed)
CREATE TABLE IF NOT EXISTS public.rider_preferences (
  rider_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  favored_driver_id UUID REFERENCES auth.users(id),
  preferred_vehicle_type TEXT DEFAULT 'standard',
  preferred_payment_method TEXT DEFAULT 'cash',
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.rider_preferences ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rider_preferences' AND policyname = 'Rider can view own prefs') THEN
    CREATE POLICY "Rider can view own prefs" ON public.rider_preferences FOR SELECT USING (auth.uid() = rider_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rider_preferences' AND policyname = 'Driver can read favored rider') THEN
    CREATE POLICY "Driver can read favored rider" ON public.rider_preferences FOR SELECT USING (
      EXISTS (SELECT 1 FROM rides WHERE rides.driver_id = auth.uid() AND rides.rider_id = rider_preferences.rider_id AND rides.status IN ('assigned','arrived','in_progress'))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rider_preferences' AND policyname = 'Rider can update own prefs') THEN
    CREATE POLICY "Rider can update own prefs" ON public.rider_preferences FOR UPDATE USING (auth.uid() = rider_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rider_preferences' AND policyname = 'Rider can insert own prefs') THEN
    CREATE POLICY "Rider can insert own prefs" ON public.rider_preferences FOR INSERT WITH CHECK (auth.uid() = rider_id);
  END IF;
END $$;

-- 4. Auto-create defaults on signup (from archive)
CREATE OR REPLACE FUNCTION public.handle_new_user_profile_defaults()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_preferences (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.notification_settings (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_defaults ON auth.users;
CREATE TRIGGER on_auth_user_created_defaults
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_profile_defaults();

-- Backfill for existing users
INSERT INTO public.user_preferences (user_id) SELECT id FROM auth.users ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.notification_settings (user_id) SELECT id FROM auth.users ON CONFLICT (user_id) DO NOTHING;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_rider_preferences_favored_driver ON public.rider_preferences(favored_driver_id) WHERE favored_driver_id IS NOT NULL;
