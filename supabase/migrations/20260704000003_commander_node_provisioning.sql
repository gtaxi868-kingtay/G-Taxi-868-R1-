-- Commander (sub-agent) NFC node provisioning with pending-review approval
-- =========================================================================
-- The franchise spine: a Field Commander taps an unclaimed NFC tag and
-- registers it (location + GPS + geofence). It lands in pending_review and
-- is INACTIVE (won't serve taps) until an admin approves it. Registration
-- also mints a one-time merchant invite the commander shares so the store
-- owner can claim/link their account to that exact tag.
--
-- Quality control: nothing a commander registers goes live without admin
-- approval, so "junk" nodes never reach riders.
-- =========================================================================

-- 1. provision_status on kiosk_nodes (separate from hardware lifecycle_status).
--    Existing nodes are 'active' (grandfathered); new commander nodes start
--    'pending_review' with is_active = false so nfc_event_handler's
--    `.eq('is_active', true)` lookup skips them until approved.
ALTER TABLE public.kiosk_nodes
ADD COLUMN IF NOT EXISTS provision_status text NOT NULL DEFAULT 'active'
  CHECK (provision_status IN ('pending_review', 'active', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_kiosk_nodes_pending
  ON public.kiosk_nodes (provision_status) WHERE provision_status = 'pending_review';

-- 2. merchant_invites — one-time tokens minted at registration.
CREATE TABLE IF NOT EXISTS public.merchant_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token         uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  kiosk_node_id uuid NOT NULL REFERENCES public.kiosk_nodes(id) ON DELETE CASCADE,
  commander_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  merchant_name text,
  merchant_id   uuid REFERENCES public.merchants(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'expired')),
  claimed_at    timestamptz,
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_merchant_invites_commander ON public.merchant_invites (commander_id);
CREATE INDEX IF NOT EXISTS idx_merchant_invites_node ON public.merchant_invites (kiosk_node_id);

ALTER TABLE public.merchant_invites ENABLE ROW LEVEL SECURITY;

-- Commander sees their own invites; admin sees all. Merchants claim via the
-- SECURITY DEFINER RPC below (not direct table reads), so no token-read policy.
CREATE POLICY merchant_invites_commander_select ON public.merchant_invites
  FOR SELECT USING (commander_id = auth.uid());
CREATE POLICY merchant_invites_admin_all ON public.merchant_invites
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- 3. commander_register_node — the field-provisioning entry point.
CREATE OR REPLACE FUNCTION public.commander_register_node(
  p_tag_uid          text,
  p_location_name    text,
  p_address          text,
  p_lat              double precision,
  p_lng              double precision,
  p_merchant_name    text DEFAULT NULL,
  p_geofence_radius_m integer DEFAULT 150
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_territory uuid;
  v_node_id   uuid;
  v_token     uuid;
BEGIN
  -- Gate: only an ACTIVE pod commander (sub-agent) may provision nodes.
  IF NOT EXISTS (
    SELECT 1 FROM public.pod_commanders WHERE user_id = auth.uid() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Only an active commander can register a node';
  END IF;

  SELECT territory_id INTO v_territory
  FROM public.pod_commanders
  WHERE user_id = auth.uid() AND status = 'active'
  LIMIT 1;

  IF p_tag_uid IS NULL OR length(trim(p_tag_uid)) = 0 THEN
    RAISE EXCEPTION 'tag_uid is required';
  END IF;

  IF EXISTS (SELECT 1 FROM public.kiosk_nodes WHERE tag_uid = p_tag_uid) THEN
    RAISE EXCEPTION 'This tag is already registered';
  END IF;

  -- kiosk_nodes.tag_uid FKs to identity_tags — provision the physical tag
  -- there first (tag_type NULL = a non-personal node tag).
  INSERT INTO public.identity_tags (tag_uid, is_active, metadata)
  VALUES (p_tag_uid, true, jsonb_build_object('kind', 'kiosk_node'))
  ON CONFLICT (tag_uid) DO NOTHING;

  INSERT INTO public.kiosk_nodes (
    tag_uid, location_name, pickup_address, lat, lng,
    geofence_radius_m, default_services, is_active, provision_status,
    assigned_to, territory_id
  ) VALUES (
    p_tag_uid, p_location_name, p_address, p_lat, p_lng,
    COALESCE(p_geofence_radius_m, 150), ARRAY['ride']::text[], false, 'pending_review',
    auth.uid(), v_territory
  )
  RETURNING id INTO v_node_id;

  INSERT INTO public.merchant_invites (kiosk_node_id, commander_id, merchant_name)
  VALUES (v_node_id, auth.uid(), p_merchant_name)
  RETURNING token INTO v_token;

  RETURN jsonb_build_object(
    'success', true,
    'node_id', v_node_id,
    'status', 'pending_review',
    'invite_token', v_token,
    'invite_url', 'gtaxi://merchant-onboard/' || v_token::text
  );
END;
$$;

-- 4. admin_review_node — approve (go live) or reject a pending node.
CREATE OR REPLACE FUNCTION public.admin_review_node(
  p_node_id uuid,
  p_approve boolean,
  p_reason  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_email text;
  v_new_status  text;
BEGIN
  SELECT email INTO v_admin_email FROM public.profiles WHERE id = auth.uid() AND role = 'admin';
  IF v_admin_email IS NULL THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  IF p_approve THEN
    UPDATE public.kiosk_nodes
    SET is_active = true, provision_status = 'active', commissioned_at = now()
    WHERE id = p_node_id AND provision_status = 'pending_review';
    v_new_status := 'active';
  ELSE
    UPDATE public.kiosk_nodes
    SET is_active = false, provision_status = 'rejected'
    WHERE id = p_node_id AND provision_status = 'pending_review';
    v_new_status := 'rejected';
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Node not found or not pending review';
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, admin_email, action, target_type, target_id, previous_status, new_status, reason)
  VALUES (auth.uid(), v_admin_email, 'node_review', 'kiosk_node', p_node_id::text, 'pending_review', v_new_status, p_reason);

  RETURN jsonb_build_object('success', true, 'node_id', p_node_id, 'status', v_new_status);
END;
$$;

-- 5. Grants (RPC lockdown pattern: authenticated only; guard is inside).
REVOKE ALL ON FUNCTION public.commander_register_node(text, text, text, double precision, double precision, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_review_node(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commander_register_node(text, text, text, double precision, double precision, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_node(uuid, boolean, text) TO authenticated;
