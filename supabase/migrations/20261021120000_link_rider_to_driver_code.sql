-- ═══════════════════════════════════════════════════════════════════
-- A rider can join with a DRIVER's code (founder, 2026-10-21: "drivers
-- can tap their keychain to give riders their code").
--
-- PROVEN 2026-10-21: this path never worked. Driver codes are stored as
-- referral_codes.type = 'driver'; the rider app only called
-- apply_referral_code(p_type => 'rider'), so a driver's code always came
-- back "Invalid referral code". The function meant to link them
-- (referral_driver_signup) was never deployed (100-function cap) and
-- required the driver to be online at that moment.
--
-- link_rider_to_driver_code(p_code): for the signed-in rider only.
--   * code must be a real driver's code, not your own
--   * new riders only (no completed ride yet), linked once
--   * rate-limited (10 tries/hour) so codes cannot be guessed
--   * links via the existing create_driver_referral_network, which sets
--     profiles.referral_source_driver_id: that is what complete_ride reads
--     to pay the driver-brings-rider reward (increment_referral_reward_rides)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.link_rider_to_driver_code(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_driver_user uuid;
  v_driver_id uuid;
  v_driver_name text;
  v_existing uuid;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sign in first.');
  END IF;
  IF NOT public.check_rate_limit(v_uid, 'link_rider_to_driver_code', 10, 3600) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many tries. Wait an hour and try again.');
  END IF;

  SELECT user_id INTO v_driver_user
    FROM public.referral_codes
   WHERE code = upper(trim(coalesce(p_code, ''))) AND type = 'driver';
  IF v_driver_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code');
  END IF;
  IF v_driver_user = v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'You cannot use your own code.');
  END IF;

  SELECT id, name INTO v_driver_id, v_driver_name FROM public.drivers WHERE user_id = v_driver_user;
  IF v_driver_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'That driver is no longer registered.');
  END IF;

  SELECT referral_source_driver_id INTO v_existing FROM public.profiles WHERE id = v_uid;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are already linked to a driver.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.rides WHERE rider_id = v_uid AND status = 'completed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Driver codes are for new riders only.');
  END IF;

  v_result := public.create_driver_referral_network(v_uid, v_driver_id);
  IF NOT coalesce((v_result->>'success')::boolean, false) THEN
    RETURN v_result;
  END IF;

  RETURN jsonb_build_object('success', true,
    'driver_first_name', nullif(split_part(coalesce(v_driver_name, ''), ' ', 1), ''));
END;
$function$;

REVOKE ALL ON FUNCTION public.link_rider_to_driver_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_rider_to_driver_code(text) TO authenticated;
