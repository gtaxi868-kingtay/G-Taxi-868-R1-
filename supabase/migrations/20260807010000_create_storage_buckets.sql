-- ═══════════════════════════════════════════════════════════════════════════
-- CREATE THE TWO BUCKETS THE RIDER APP HAS BEEN UPLOADING TO
-- (2026-08-07)
--
-- Found while mapping storage for the retention purge: the rider app uploads
-- profile photos to 'avatars' (EditProfileScreen) and identity selfies to
-- 'verification-photos' (RideConfirmationScreen), and NEITHER BUCKET EXISTED.
-- Both uploads have been failing for as long as those screens have shipped.
-- No migration ever created them — bucket setup in this project was done by
-- hand in the dashboard and never tracked (see 20260726000000:32-40), and
-- these two were simply missed.
--
-- PUBLIC vs PRIVATE — decided per bucket, not by default:
--
--   avatars            PUBLIC. A driver must render the rider's photo at
--                      pickup (and the rider the driver's) from a url stored
--                      on profiles.avatar_url. Paths are <uuid>/<epoch>.png,
--                      so unguessable, and the url only ever reaches someone
--                      RLS already lets read that profile row.
--
--   verification-photos PRIVATE. This is the closest thing the rider app holds
--                      to an identity document, and PRIVACY_POLICY.md 8
--                      promises those live in private storage behind
--                      time-limited links. RideConfirmationScreen was calling
--                      getPublicUrl, which on a private bucket returns a link
--                      that 403s — the preview would have broken silently.
--                      Switched to createSignedUrl in the same commit.
--
-- PATH CONVENTION: both are <auth.uid()>/<file>. Not cosmetic — one policy
-- shape covers both, and anonymise_user finds a deleted account's files by
-- that prefix. The selfie path was 'selfies/<uid>/...', which would have
-- failed the policy AND been missed at deletion time; it was corrected to
-- match.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 5242880,
        ARRAY['image/png','image/jpeg','image/jpg','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true, file_size_limit = 5242880,
      allowed_mime_types = ARRAY['image/png','image/jpeg','image/jpg','image/webp'];

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('verification-photos', 'verification-photos', false, 10485760,
        ARRAY['image/png','image/jpeg','image/jpg','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = 10485760,
      allowed_mime_types = ARRAY['image/png','image/jpeg','image/jpg','image/webp'];

DROP POLICY IF EXISTS avatars_own_folder_insert ON storage.objects;
DROP POLICY IF EXISTS avatars_own_folder_update ON storage.objects;
DROP POLICY IF EXISTS avatars_own_folder_delete ON storage.objects;
DROP POLICY IF EXISTS avatars_own_folder_select ON storage.objects;

CREATE POLICY avatars_own_folder_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY avatars_own_folder_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY avatars_own_folder_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY avatars_own_folder_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS verification_own_folder_insert ON storage.objects;
DROP POLICY IF EXISTS verification_own_folder_select ON storage.objects;

CREATE POLICY verification_own_folder_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'verification-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- SELECT is what lets the person who took the photo create a signed url for
-- their own preview. Deliberately NO update and NO delete policy: a
-- verification selfie the user can silently replace or remove is worthless as
-- a fraud control. Removal happens through the retention queue, under
-- service_role.
CREATE POLICY verification_own_folder_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'verification-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
