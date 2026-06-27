-- Migration: 20260617000005_create_merchant_key_rpc
-- Creates admin_create_merchant_key RPC that hashes keys on INSERT
-- (matching the SHA-256 verification in merchant_auth.ts)
-- and fixes merchant_gateway column reference.

BEGIN;

-- ── 1. admin_create_merchant_key ─────────────────────────────────────────
-- Admin creates a merchant API key. Takes raw key, stores SHA-256 hash.
-- Returns raw key once (admin gives it to merchant, never stored plaintext).
CREATE OR REPLACE FUNCTION public.admin_create_merchant_key(
    p_merchant_id UUID,
    p_raw_key     TEXT,
    p_label       TEXT,
    p_scopes      TEXT[] DEFAULT '{order:read}'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_key_hash TEXT;
BEGIN
    -- Only admins can create merchant keys
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    IF p_raw_key IS NULL OR length(p_raw_key) < 8 THEN
        RAISE EXCEPTION 'Key must be at least 8 characters';
    END IF;

    -- SHA-256 hash the raw key before storing
    v_key_hash := encode(digest(p_raw_key, 'sha256'), 'hex');

    INSERT INTO public.merchant_api_keys (merchant_id, key_hash, label, scopes, is_active)
    VALUES (p_merchant_id, v_key_hash, p_label, p_scopes, true);

    -- Return raw key so admin can show it to merchant once
    RETURN jsonb_build_object(
        'success', true,
        'raw_key', p_raw_key,
        'merchant_id', p_merchant_id,
        'label', p_label
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_merchant_key(UUID, TEXT, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_merchant_key(UUID, TEXT, TEXT, TEXT[]) TO service_role, authenticated;

-- ── 2. admin_rotate_merchant_key ─────────────────────────────────────────
-- Admin rotates a key: deactivates old, creates new with SHA-256 hash.
CREATE OR REPLACE FUNCTION public.admin_rotate_merchant_key(
    p_key_id   UUID,
    p_new_raw  TEXT,
    p_new_label TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_merchant_id UUID;
    v_new_hash TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    SELECT merchant_id INTO v_merchant_id FROM public.merchant_api_keys WHERE id = p_key_id;
    IF v_merchant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Key not found');
    END IF;

    -- Deactivate old
    UPDATE public.merchant_api_keys SET is_active = false WHERE id = p_key_id;

    -- Insert new
    v_new_hash := encode(digest(p_new_raw, 'sha256'), 'hex');
    INSERT INTO public.merchant_api_keys (merchant_id, key_hash, label, scopes, is_active)
    VALUES (v_merchant_id, v_new_hash, COALESCE(p_new_label, 'Rotated ' || now()::date), '{order:read}', true);

    RETURN jsonb_build_object('success', true, 'raw_key', p_new_raw, 'merchant_id', v_merchant_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_rotate_merchant_key(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_rotate_merchant_key(UUID, TEXT, TEXT) TO service_role, authenticated;

COMMIT;
