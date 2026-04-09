-- Migration: 20260408010000_manual_deposits_schema.sql
-- Description: Creates the infrastructure for drivers to upload proof-of-payment for manual bank transfers.

BEGIN;

-- 1. Create manual_deposits table
-- This tracks the state of bank transfer receipts.
CREATE TABLE IF NOT EXISTS public.manual_deposits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES public.profiles(id),
    amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
    receipt_url     TEXT NOT NULL, -- URL to the image in Supabase Storage
    status          TEXT NOT NULL DEFAULT 'pending' 
                      CHECK (status IN ('pending', 'approved', 'rejected')),
    admin_note      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.manual_deposits ENABLE ROW LEVEL SECURITY;

-- Drivers can only see their own deposits.
CREATE POLICY "Users view own deposits" ON public.manual_deposits
    FOR SELECT USING (auth.uid() = user_id);

-- Drivers can insert their own deposits.
CREATE POLICY "Users insert own deposits" ON public.manual_deposits
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Admins can do everything (assumes 'admin' role logic already exists in profiles)
CREATE POLICY "Admins full access to deposits" ON public.manual_deposits
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- 2. Create Storage Bucket for Receipts
-- (Note: This is usually done via SQL for Supabase Storage configuration)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('receipts', 'receipts', true)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies
-- Allow authenticated users to upload to the receipts bucket
CREATE POLICY "Public Access"
ON storage.objects FOR SELECT
USING ( bucket_id = 'receipts' );

CREATE POLICY "Authenticated Upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id = 'receipts' );

-- 3. Function to credit wallet on approval
-- This trigger automatically creates a wallet transaction when a deposit is approved.
CREATE OR REPLACE FUNCTION public.handle_manual_deposit_approval()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.status = 'pending' AND NEW.status = 'approved') THEN
        INSERT INTO public.wallet_transactions (
            user_id,
            amount,
            transaction_type,
            description,
            status,
            ride_id
        ) VALUES (
            NEW.user_id,
            NEW.amount_cents,
            'topup',
            'Manual bank transfer approved — Receipt ref: ' || NEW.id,
            'completed',
            NULL
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_deposit_approved
    AFTER UPDATE ON public.manual_deposits
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_manual_deposit_approval();

COMMIT;
