-- Migration: 20260401010100_stripe_customer_trigger.sql
-- Phase 14 Fix 14.3 — Automate Stripe Customer creation via Edge Function Trigger.

-- 1. Enable the vault for secure URL storage (optional but good practice)
-- 2. Create the Trigger Function
CREATE OR REPLACE FUNCTION public.trigger_create_stripe_customer()
RETURNS TRIGGER AS $$
BEGIN
  -- We call the edge function via an asynchronous HTTP request.
  -- This ensures the signup process isn't slowed down by Stripe's API.
  PERFORM
    net.http_post(
      url := (SELECT value FROM stripe_config WHERE key = 'create_customer_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT value FROM stripe_config WHERE key = 'service_role_key')
      ),
      body := jsonb_build_object('record', row_to_json(NEW))
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create the Trigger
DROP TRIGGER IF EXISTS on_profile_created_stripe ON public.profiles;
CREATE TRIGGER on_profile_created_stripe
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trigger_create_stripe_customer();

-- 4. Config Table (To avoid hardcoding URLs in the trigger)
CREATE TABLE IF NOT EXISTS public.stripe_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Seed initial config (User will need to update the URL if project ref changes)
INSERT INTO public.stripe_config (key, value)
VALUES 
  ('create_customer_url', 'http://localhost:54321/functions/v1/create_stripe_customer'), -- Updated via env later
  ('service_role_key', 'SERVICE_ROLE_KEY_HERE')
ON CONFLICT (key) DO NOTHING;
