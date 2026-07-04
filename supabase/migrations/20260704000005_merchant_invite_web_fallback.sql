-- Fix commander_register_node's invite_url: it returned a pure gtaxi://
-- deep link, which does nothing if the merchant has no app installed (they
-- almost certainly don't — they're being onboarded from scratch). Point it
-- at the web claim page instead, following this codebase's existing
-- gtaxi.app web-fallback convention (see send_b2b_tracking_sms, merchant
-- edge functions, which already link to https://gtaxi.app/track/<id>).
-- The web page itself is a plain HTML claim form — no app required.

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
  IF NOT EXISTS (SELECT 1 FROM public.pod_commanders WHERE user_id = auth.uid() AND status = 'active') THEN
    RAISE EXCEPTION 'Only an active commander can register a node';
  END IF;

  SELECT territory_id INTO v_territory FROM public.pod_commanders WHERE user_id = auth.uid() AND status = 'active' LIMIT 1;

  IF p_tag_uid IS NULL OR length(trim(p_tag_uid)) = 0 THEN
    RAISE EXCEPTION 'tag_uid is required';
  END IF;

  IF EXISTS (SELECT 1 FROM public.kiosk_nodes WHERE tag_uid = p_tag_uid) THEN
    RAISE EXCEPTION 'This tag is already registered';
  END IF;

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
    'success', true, 'node_id', v_node_id, 'status', 'pending_review',
    'invite_token', v_token,
    'invite_url', 'https://gtaxi.app/merchant-onboard?invite=' || v_token::text
  );
END;
$$;
