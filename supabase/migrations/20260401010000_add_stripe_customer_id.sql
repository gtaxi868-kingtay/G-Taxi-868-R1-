-- Migration: 20260401010000_add_stripe_customer_id.sql
-- Phase 14 Fix 14.1 — Add Stripe Customer ID to profiles for saved card support.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer_id ON public.profiles(stripe_customer_id);

COMMENT ON COLUMN public.profiles.stripe_customer_id IS 'The permanent Stripe Customer ID for this user, used for saved payment methods.';
