-- Admin-gated RPCs for the Platform Control page.
-- Both functions verify admin role before executing so non-admin
-- authenticated users (drivers, riders) cannot call them.

CREATE OR REPLACE FUNCTION admin_update_vertical(
    p_id          UUID,
    p_is_enabled  BOOLEAN,
    p_rollout     INTEGER DEFAULT 100
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_role TEXT;
BEGIN
    SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
    IF v_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Unauthorized: admin role required';
    END IF;

    UPDATE vertical_settings SET
        is_enabled         = p_is_enabled,
        rollout_percentage = p_rollout,
        updated_at         = now(),
        enabled_by         = auth.uid()
    WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_vertical(UUID, BOOLEAN, INTEGER) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_toggle_feature_flag(
    p_id       TEXT,
    p_is_active BOOLEAN
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_role TEXT;
BEGIN
    SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
    IF v_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Unauthorized: admin role required';
    END IF;

    UPDATE system_feature_flags SET
        is_active  = p_is_active,
        toggled_at = now(),
        toggled_by = auth.uid()
    WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_toggle_feature_flag(TEXT, BOOLEAN) TO authenticated;
