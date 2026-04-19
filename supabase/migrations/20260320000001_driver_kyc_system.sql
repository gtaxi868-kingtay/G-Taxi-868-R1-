-- Migration: 20260320000001_driver_kyc_system.sql
-- Enables professional driver verification and document tracking.

BEGIN;

-- 1. Add verified_status to drivers
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'driver_verified_status') THEN
        CREATE TYPE public.driver_verified_status AS ENUM (
            'unverified', 'pending', 'approved', 'rejected'
        );
    END IF;
END $$;

ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS verified_status public.driver_verified_status DEFAULT 'unverified';

-- 2. Create driver_documents table
CREATE TABLE IF NOT EXISTS public.driver_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL, -- 'permit_front', 'permit_back', 'insurance', 'taxi_badge', 'vehicle_inspection'
    storage_path TEXT NOT NULL, -- path in Supabase Storage
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason TEXT,
    expires_at DATE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Security (RLS)
ALTER TABLE public.driver_documents ENABLE ROW LEVEL SECURITY;

-- Create policies if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'driver_documents' AND policyname = 'Drivers can view own docs'
    ) THEN
        CREATE POLICY "Drivers can view own docs" ON public.driver_documents
            FOR SELECT USING (driver_id = auth.uid());
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'driver_documents' AND policyname = 'Drivers can insert own docs'
    ) THEN
        CREATE POLICY "Drivers can insert own docs" ON public.driver_documents
            FOR INSERT WITH CHECK (driver_id = auth.uid());
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'driver_documents' AND policyname = 'Admins full access docs'
    ) THEN
        CREATE POLICY "Admins full access docs" ON public.driver_documents
            FOR ALL TO authenticated USING (
                EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
            );
    END IF;
END $$;

-- 4. Storage Policies (Conceptual - assumes bucket 'driver-documents' exists)
-- Note: These are usually set in the Storage UI or via SQL on the storage schema.
-- Assuming standard Supabase storage setup:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('driver-documents', 'driver-documents', false);

COMMIT;
