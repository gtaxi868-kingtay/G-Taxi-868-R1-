-- =============================================================================
-- Unified Identity — Admin RPC for registering/updating identity tags
-- =============================================================================
-- Applied directly to production on 2026-07-16 (v 20260716022237).
-- Reconstructed from DB pg_proc sources.

-- ---------------------------------------------------------------------------
-- register_unified_identity_admin(p_profile_id, p_tag_uid, p_tag_type,
--                                  p_label, p_metadata)
-- Service-role only. Upserts into unified_identities:
--   - New tag_uid: INSERT
--   - Existing: UPDATE last_tapped_at, label, metadata (merge)
-- Returns: success, identity_id, profile_id, tag_uid
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_unified_identity_admin(
  p_profile_id uuid,
  p_tag_uid    text,
  p_tag_type   text DEFAULT 'band',
  p_label      text DEFAULT NULL,
  p_metadata   jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_profile_id IS NULL OR p_tag_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_id and tag_uid required');
  END IF;

  INSERT INTO public.unified_identities (profile_id, tag_uid, tag_type, label, metadata)
  VALUES (p_profile_id, p_tag_uid, p_tag_type, p_label, p_metadata)
  ON CONFLICT (tag_uid) DO UPDATE SET
    last_tapped_at = now(),
    label = COALESCE(p_label, unified_identities.label),
    metadata = unified_identities.metadata || p_metadata
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'success', true,
    'identity_id', v_id,
    'profile_id', p_profile_id,
    'tag_uid', p_tag_uid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_unified_identity_admin(uuid, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_unified_identity_admin(uuid, text, text, text, jsonb) TO service_role;
