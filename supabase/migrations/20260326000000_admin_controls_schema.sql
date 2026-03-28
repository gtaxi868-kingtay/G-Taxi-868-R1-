-- Phase 3: Administrative Control Schema Extensions (Strict Diff Only)

-- 1. Extend rides table
ALTER TABLE public.rides 
ADD COLUMN IF NOT EXISTS admin_override BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS admin_id UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS override_reason TEXT;

-- 2. Extend profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS suspended BOOLEAN DEFAULT false;

-- 3. Create system_features table
CREATE TABLE IF NOT EXISTS public.system_features (
    id TEXT PRIMARY KEY DEFAULT 'global',
    admin_controls BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Ensure a global row exists
INSERT INTO public.system_features (id, admin_controls) 
VALUES ('global', true) 
ON CONFLICT (id) DO NOTHING;
