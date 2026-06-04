-- ====================================================================
-- Step 2: Storage Perimeter Hardening
-- Closes the "authenticated wildcard" loophole on merchant-intake-photos,
-- creates missing driver/rider verification buckets as private,
-- and replaces all legacy policies with unified owner-or-admin guardrails.
-- Target project ref: ffbbuafgeypvkpcuvdnv
-- ====================================================================

BEGIN;

-- ── 1. Create missing buckets (idempotent) ───────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('driver-documents',    'driver-documents',    false, null, null),
  ('driver_credentials',  'driver_credentials',  false, null, null),
  ('rider_profiles',      'rider_profiles',      false, null, null)
ON CONFLICT (id)
DO UPDATE SET public = false;

-- ── 2. Force existing buckets to private ─────────────────────────────
UPDATE storage.buckets SET public = false
WHERE id IN ('merchant-intake-photos', 'receipts');

-- ── 3. Drop ALL legacy policies for the target buckets ───────────────
DROP POLICY IF EXISTS "Public Access for Intake Photos"   ON storage.objects;
DROP POLICY IF EXISTS "Merchants can upload intake photos" ON storage.objects;
DROP POLICY IF EXISTS "merchant_intake_select_auth"        ON storage.objects;
DROP POLICY IF EXISTS "merchant_intake_insert_auth"        ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload intake photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Upload"               ON storage.objects;
DROP POLICY IF EXISTS "Public Access"                      ON storage.objects;
DROP POLICY IF EXISTS "receipts_select_own"                ON storage.objects;
DROP POLICY IF EXISTS "receipts_insert_own"                ON storage.objects;

-- ── 4. Unified SELECT policy: owner OR admin ─────────────────────────
CREATE POLICY "storage_select_owner_or_admin"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id IN ('merchant-intake-photos', 'driver-documents', 'driver_credentials', 'rider_profiles', 'receipts')
  AND (
    auth.uid() = owner
    OR (storage.foldername(name))[1] = auth.uid()::text
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  )
);

-- ── 5. Unified INSERT policy: owner only ─────────────────────────────
CREATE POLICY "storage_insert_owner_only"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id IN ('merchant-intake-photos', 'driver-documents', 'driver_credentials', 'rider_profiles', 'receipts')
  AND (
    auth.uid() = owner
    OR (storage.foldername(name))[1] = auth.uid()::text
  )
);

-- ── 6. DELETE policy: owner OR admin ─────────────────────────────────
CREATE POLICY "storage_delete_owner_or_admin"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id IN ('merchant-intake-photos', 'driver-documents', 'driver_credentials', 'rider_profiles', 'receipts')
  AND (
    auth.uid() = owner
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  )
);

COMMIT;
