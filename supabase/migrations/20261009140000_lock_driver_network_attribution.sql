-- ═══════════════════════════════════════════════════════════════════
-- Lock drivers.recruited_by_commander_user_id / recruited_at.
--
-- These two columns decide who receives the 2% network override on every
-- ride a driver completes (compute_ride_split). The drivers table grants
-- UPDATE to authenticated with an own-row policy, and the existing
-- protect_driver_sensitive_columns trigger did not cover them -- so any
-- signed-in driver could point their 2% at any network directly,
-- skipping the request/approve flow and the 30-day switching lock.
--
-- After this, only two paths can change them:
--   * service_role (edge functions: register_driver_with_code, admin tools)
--   * decide_network_join(), which sets a transaction-local flag right
--     before its single UPDATE. A client cannot set that flag: each
--     PostgREST request is its own transaction and set_config is not an
--     exposed RPC.
--
-- Deliberately NOT added here (flagged separately for review): rating,
-- rating_count, credit_limit_cents, credit_used_cents are also
-- driver-writable today, but legitimate definer functions update some of
-- them under the caller's authenticated role, so locking them needs a
-- per-column audit first.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.protect_driver_sensitive_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  -- Service role (edge functions, admin tools) may change anything.
  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.commission_tier       IS DISTINCT FROM OLD.commission_tier
  OR NEW.custom_commission_rate IS DISTINCT FROM OLD.custom_commission_rate
  OR NEW.is_bot                IS DISTINCT FROM OLD.is_bot
  OR NEW.is_verified           IS DISTINCT FROM OLD.is_verified
  OR NEW.verified_status       IS DISTINCT FROM OLD.verified_status
  OR NEW.fleet_lease_id        IS DISTINCT FROM OLD.fleet_lease_id
  OR NEW.region_id             IS DISTINCT FROM OLD.region_id
  OR NEW.spoof_flag_count      IS DISTINCT FROM OLD.spoof_flag_count
  OR NEW.spoof_suspended       IS DISTINCT FROM OLD.spoof_suspended
  OR NEW.acceptance_rate       IS DISTINCT FROM OLD.acceptance_rate
  OR NEW.user_id               IS DISTINCT FROM OLD.user_id
  THEN
    RAISE EXCEPTION 'Direct modification of protected driver columns is not permitted';
  END IF;

  -- Network attribution: only decide_network_join() may move it.
  IF (NEW.recruited_by_commander_user_id IS DISTINCT FROM OLD.recruited_by_commander_user_id
      OR NEW.recruited_at IS DISTINCT FROM OLD.recruited_at)
     AND coalesce(current_setting('gtaxi.network_move', true), '') <> 'on' THEN
    RAISE EXCEPTION 'A driver''s network can only change through a network join request';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.decide_network_join(p_request_id uuid, p_approve boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_req RECORD; v_driver RECORD; v_name text;
BEGIN
    SELECT * INTO v_req FROM public.network_join_requests WHERE id = p_request_id FOR UPDATE;
    IF v_req.id IS NULL OR v_req.commander_user_id IS DISTINCT FROM auth.uid() THEN RETURN jsonb_build_object('success', false, 'error', 'Request not found.'); END IF;
    IF v_req.status <> 'pending' THEN RETURN jsonb_build_object('success', false, 'error', 'This request was already ' || v_req.status || '.'); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.pod_commanders WHERE id = v_req.commander_id AND status = 'active') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Your network is not active.'); END IF;
    v_name := public.network_display_name(v_req.commander_user_id);
    IF NOT p_approve THEN
        UPDATE public.network_join_requests SET status = 'declined', decided_at = now() WHERE id = v_req.id;
        PERFORM public.notify_user(v_req.driver_user_id, 'grid', v_name || ' isn''t taking you on right now', 'You can ask another network from the Networks screen.');
        RETURN jsonb_build_object('success', true, 'status', 'declined');
    END IF;
    SELECT id, name, recruited_by_commander_user_id, recruited_at INTO v_driver FROM public.drivers WHERE id = v_req.driver_id FOR UPDATE;
    -- Re-check the cooldown at decision time: the driver may have moved since asking.
    IF v_driver.recruited_by_commander_user_id IS NOT NULL AND v_driver.recruited_by_commander_user_id <> v_req.commander_user_id
       AND v_driver.recruited_at IS NOT NULL AND v_driver.recruited_at > now() - interval '30 days' THEN
        UPDATE public.network_join_requests SET status = 'cancelled', decided_at = now() WHERE id = v_req.id;
        RETURN jsonb_build_object('success', false, 'error', 'This driver joined another network recently and can''t move yet.');
    END IF;
    -- Authorises exactly this UPDATE past protect_driver_sensitive_columns;
    -- transaction-local, so it ends with this call.
    PERFORM set_config('gtaxi.network_move', 'on', true);
    UPDATE public.drivers SET recruited_by_commander_user_id = v_req.commander_user_id, recruited_at = now() WHERE id = v_driver.id;
    PERFORM set_config('gtaxi.network_move', 'off', true);
    UPDATE public.network_join_requests SET status = 'approved', decided_at = now() WHERE id = v_req.id;
    PERFORM public.notify_user(v_req.driver_user_id, 'grid', 'You''re in ' || v_name, 'You now drive under ' || v_name || '. Nothing changes in how you''re paid per ride.');
    IF v_driver.recruited_by_commander_user_id IS NOT NULL AND v_driver.recruited_by_commander_user_id <> v_req.commander_user_id THEN
        PERFORM public.notify_user(v_driver.recruited_by_commander_user_id, 'grid', 'A driver left your network',
            COALESCE(v_driver.name, 'A driver') || ' moved to another network. You stop earning on their rides from now on.');
    END IF;
    RETURN jsonb_build_object('success', true, 'status', 'approved');
END;
$function$;
REVOKE ALL ON FUNCTION public.decide_network_join(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_network_join(uuid, boolean) TO authenticated;
