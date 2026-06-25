-- Migration: 20260325000000_unify_admin_roles.sql
-- Goal: Unify administrator authorization from a boolean 'is_admin' to a 'role' string.

-- 1. ADD ROLE COLUMN IF NOT EXISTS
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role') THEN
        ALTER TABLE public.profiles ADD COLUMN role TEXT DEFAULT 'rider';
    END IF;
END $$;
-- 2. MIGRATE DATA FROM is_admin
-- If a user was marked is_admin=true, they are now role='admin'
UPDATE public.profiles 
SET role = 'admin' 
WHERE is_admin = true AND (role IS NULL OR role = 'rider');
-- 3. SEED PRIMARY ADMIN (If not already set)
-- Direct ID for gtaxi868@gmail.com (extracted from current environment context if available)
-- If we don't have the ID, we rely on the email match.
UPDATE public.profiles
SET role = 'admin'
WHERE email = 'gtaxi868@gmail.com';
-- 4. ENSURE INDEX FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
-- 5. RLS UPDATES (Verification)
-- Ensure service_role can still manage profiles (usually already true)
-- We might need a policy specifically for admin-to-admin role toggling later.;
