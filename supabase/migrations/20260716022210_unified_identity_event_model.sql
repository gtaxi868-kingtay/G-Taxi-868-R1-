-- =============================================================================
-- Unified Identity Event Model: bridge NFC keychains, band tags, and
-- identity_tags into a single unified_identities table with tag-to-profile
-- resolution for settlement flows.
-- =============================================================================
-- Applied directly to production on 2026-07-16 (v 20260716022210).
-- Reconstructed from DB schema and pg_proc sources.

-- ---------------------------------------------------------------------------
-- 1. Core table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.unified_identities (
  id              uuid          NOT NULL DEFAULT gen_random_uuid(),
  profile_id      uuid          NOT NULL,
  tag_uid         text          NOT NULL,
  tag_type        text          NOT NULL,
  label           text,
  is_active       boolean       NOT NULL DEFAULT true,
  metadata        jsonb         NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  last_tapped_at  timestamptz,

  CONSTRAINT unified_identities_pkey PRIMARY KEY (id),
  CONSTRAINT unified_identities_tag_uid_key UNIQUE (tag_uid)
);

CREATE INDEX IF NOT EXISTS idx_unified_identities_profile
  ON public.unified_identities (profile_id);

ALTER TABLE public.unified_identities ENABLE ROW LEVEL SECURITY;

-- Service-role only; RLS blocks public mutations
CREATE POLICY unified_identities_service_access ON public.unified_identities
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 2. Resolve a tag_uid to a rider/driver profile.
--    1st choice: unified_identities (new system)
--    2nd choice: identity_tags (legacy, backward compatibility)
--    Returns: found, profile_id, tag_type, full_name
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_tag_to_profile(p_tag_uid text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_profile_id uuid;
  v_tag_type   text;
  v_is_active  boolean;
  v_full_name  text;
BEGIN
  SELECT ui.profile_id, ui.tag_type, ui.is_active, p.full_name
    INTO v_profile_id, v_tag_type, v_is_active, v_full_name
    FROM public.unified_identities ui
    JOIN public.profiles p ON p.id = ui.profile_id
   WHERE ui.tag_uid = p_tag_uid
   LIMIT 1;

  IF v_profile_id IS NULL THEN
    SELECT it.profile_id, 'identity_tag'::text, it.is_active, p.full_name
      INTO v_profile_id, v_tag_type, v_is_active, v_full_name
      FROM public.identity_tags it
      JOIN public.profiles p ON p.id = it.profile_id
     WHERE it.tag_uid = p_tag_uid
     LIMIT 1;
  END IF;

  IF v_profile_id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'error', 'Tag not registered');
  END IF;

  IF NOT v_is_active THEN
    RETURN jsonb_build_object('found', false, 'error', 'Tag is deactivated');
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'profile_id', v_profile_id,
    'tag_type', v_tag_type,
    'full_name', v_full_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_tag_to_profile(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_tag_to_profile(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Backfill: copy active identity_tags into unified_identities
--    Idempotent — ON CONFLICT (tag_uid) skips duplicates.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.backfill_identity_tags()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  INSERT INTO public.unified_identities (profile_id, tag_uid, tag_type, label, is_active, metadata)
  SELECT it.profile_id, it.tag_uid, 'identity_tag'::text, 'Legacy import from identity_tags', it.is_active, '{}'::jsonb
    FROM public.identity_tags it
   WHERE it.is_active = true
     AND NOT EXISTS (SELECT 1 FROM public.unified_identities ui WHERE ui.tag_uid = it.tag_uid);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_identity_tags() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_identity_tags() TO service_role;
