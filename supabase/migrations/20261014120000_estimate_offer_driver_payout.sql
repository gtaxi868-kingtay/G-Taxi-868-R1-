-- ═══════════════════════════════════════════════════════════════════
-- Trip offers must show what the driver will actually be paid.
--
-- process_dispatch_queue set ride_offers.driver_payout_cents to
-- fare x (1 - PLATFORM_RATE_CENTS) = 85% (88% for commission_tier
-- 'pioneer'). But the real payout is compute_ride_split's driver_net:
-- DRIVER_SHARE_CENTS (80%) minus COMMANDER_REVSHARE_RATE_CENTS (2%) when
-- the driver's recruiter is still an active commander -> 78%. PLATFORM_RATE
-- is only a loyalty reference rate there, and commission_tier is not read at
-- all. Verified live 2026-10-14 (PLATFORM_RATE_CENTS 1500, DRIVER_SHARE_CENTS
-- 8000): every offer promised 5-10 points more than the driver gets.
--
-- This returns compute_ride_split's driver_net for a driver who is not yet
-- on the ride (offer time), using the SAME config keys, defaults and
-- recruiter rule. It deliberately excludes the rider-loyalty bonus, which
-- depends on the rider and can only ADD to driver pay -- so an offer can
-- under-state but never over-state. If compute_ride_split's driver rule
-- changes, change this with it (the dry run compares the two directly).
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.estimate_offer_driver_payout(p_gross_cents bigint, p_driver_id uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_driver_bps    int;
  v_commander_bps int;
  v_recruiter_uid uuid;
  v_has_commander boolean := false;
BEGIN
  IF p_gross_cents IS NULL OR p_gross_cents <= 0 THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(MAX(CASE WHEN key = 'DRIVER_SHARE_CENTS' THEN value_cents END), 8000),
         COALESCE(MAX(CASE WHEN key = 'COMMANDER_REVSHARE_RATE_CENTS' THEN value_cents END), 200)
    INTO v_driver_bps, v_commander_bps
    FROM public.pricing_config
   WHERE key IN ('DRIVER_SHARE_CENTS', 'COMMANDER_REVSHARE_RATE_CENTS');

  SELECT recruited_by_commander_user_id INTO v_recruiter_uid
    FROM public.drivers WHERE id = p_driver_id;

  IF v_recruiter_uid IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.pod_commanders
                    WHERE user_id = v_recruiter_uid AND status = 'active')
      INTO v_has_commander;
  END IF;

  RETURN ROUND(p_gross_cents * v_driver_bps / 10000.0)
       - CASE WHEN v_has_commander THEN ROUND(p_gross_cents * v_commander_bps / 10000.0) ELSE 0 END;
END;
$function$;

REVOKE ALL ON FUNCTION public.estimate_offer_driver_payout(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.estimate_offer_driver_payout(bigint, uuid) TO service_role;
