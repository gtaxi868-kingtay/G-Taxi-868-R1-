-- Migration: 20260527000000_phase5_push_notifications.sql
-- Phase 5: Complete push notification infrastructure.
--
-- Adds columns needed by the push notification system:
--   - profiles.last_notification_sent_at:  tracks last push sent time (anti-spam)
--   - drivers.last_notification_sent_at:   tracks last push sent time (anti-spam)
--   - profiles.notification_enabled:       user opt-in/out control
--   - drivers.notification_enabled:        user opt-in/out control

-- Add notification tracking to profiles table
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_notification_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notification_enabled BOOLEAN NOT NULL DEFAULT true;

-- Add notification tracking to drivers table
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS last_notification_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notification_enabled BOOLEAN NOT NULL DEFAULT true;

-- Index for daily_push_notifications cron queries
CREATE INDEX IF NOT EXISTS idx_profiles_last_notification_sent_at
  ON public.profiles (last_notification_sent_at)
  WHERE notification_enabled = true AND push_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_drivers_last_notification_sent_at
  ON public.drivers (last_notification_sent_at)
  WHERE notification_enabled = true AND push_token IS NOT NULL;

-- Add EXPO_PUSH_TOKENS table for Expo push ticket tracking
-- Used by daily_push_notifications to track push delivery status
CREATE TABLE IF NOT EXISTS public.expo_push_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticket_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on expo_push_tickets
ALTER TABLE public.expo_push_tickets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'expo_push_tickets'
    AND policyname = 'expo_push_tickets_select_own'
  ) THEN
    CREATE POLICY "expo_push_tickets_select_own"
      ON public.expo_push_tickets FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'expo_push_tickets'
    AND policyname = 'expo_push_tickets_insert_service'
  ) THEN
    CREATE POLICY "expo_push_tickets_insert_service"
      ON public.expo_push_tickets FOR INSERT
      WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'expo_push_tickets'
    AND policyname = 'expo_push_tickets_update_service'
  ) THEN
    CREATE POLICY "expo_push_tickets_update_service"
      ON public.expo_push_tickets FOR UPDATE
      USING (true);
  END IF;
END $$;
