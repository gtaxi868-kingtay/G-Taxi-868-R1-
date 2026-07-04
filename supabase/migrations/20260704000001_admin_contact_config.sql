-- Admin-Editable Contact / Front-Door Config
-- =========================================================================
-- Moves the business WhatsApp number out of hardcoded app/landing code and
-- into system_config (key/value TEXT), so admin can change it from the
-- dashboard without a code change or redeploy.
--
-- Reads: system_config is already anon-readable (existing RLS) — the static
--   qr-landing page and the apps read the number directly. These values are
--   public by nature (a business contact number printed on touchpoints).
-- Writes: only via admin_set_system_config() below, admin-role guarded.
-- =========================================================================

-- Seed the contact keys (idempotent — never clobbers an admin's later edit)
INSERT INTO public.system_config (key, value, description) VALUES
  ('support_whatsapp_number', '18687031000',
   'Business WhatsApp number in E.164 digits (no +) for rider/driver support and the QR/NFC front-door fallback. Editable in Admin → Platform Control.'),
  ('escape_whatsapp_number', '18687031000',
   'WhatsApp number for the G-Escape travel concierge. Editable in Admin → Platform Control.')
ON CONFLICT (key) DO NOTHING;

-- Admin-guarded setter (mirrors admin_set_pricing). SECURITY DEFINER so it can
-- write system_config regardless of table write-RLS; the role check is the gate.
CREATE OR REPLACE FUNCTION public.admin_set_system_config(p_key text, p_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT role::text FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  IF p_key IS NULL OR length(trim(p_key)) = 0 THEN
    RAISE EXCEPTION 'config key is required';
  END IF;

  INSERT INTO public.system_config (key, value, updated_at)
  VALUES (p_key, COALESCE(p_value, ''), now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
END;
$$;

-- Grants: only authenticated may call (guard inside enforces admin). Never anon.
REVOKE ALL ON FUNCTION public.admin_set_system_config(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_system_config(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_system_config(text, text) TO authenticated;
