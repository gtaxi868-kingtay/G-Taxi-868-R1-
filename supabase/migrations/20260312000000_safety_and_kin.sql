-- Phase 12: Safety and Next of Kin System
-- Adds emergency contact fields to drivers and riders tables manually, allowing automated trip alerts.

BEGIN;

-- Admin profiles (for centralized management, users table extension)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;

-- Driver explicit fields
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;

COMMIT;
