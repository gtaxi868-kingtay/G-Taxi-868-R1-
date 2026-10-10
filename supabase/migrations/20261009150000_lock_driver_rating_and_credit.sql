-- ═══════════════════════════════════════════════════════════════════
-- Lock drivers.rating / rating_count / credit_limit_cents /
-- credit_used_cents against driver self-edit.
--
-- drivers grants UPDATE to authenticated with an own-row policy, and
-- protect_driver_sensitive_columns did not cover these, so a driver
-- could set themselves to 5.0 stars with any rating_count -- shown to
-- riders on offers and to businesses in the network join inbox.
--
-- * rating / rating_count: the only legitimate writer is
--   refresh_driver_rating (AFTER INSERT on ratings), which runs under the
--   RIDER's JWT, so a plain lock would break every rating. It now sets a
--   transaction-local flag around its single UPDATE, the same pattern
--   decide_network_join uses for network attribution.
-- * credit_limit_cents / credit_used_cents: nothing writes these (verified
--   2026-10-09 across pg_proc and edge-function source), and debt
--   enforcement (check_driver_debt_limit) reads wallet_transactions, not
--   these columns -- so self-edit is harmless today but a trap the moment
--   anyone wires them in. Locked outright; service_role (admin) only.
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
  OR NEW.credit_limit_cents    IS DISTINCT FROM OLD.credit_limit_cents
  OR NEW.credit_used_cents     IS DISTINCT FROM OLD.credit_used_cents
  THEN
    RAISE EXCEPTION 'Direct modification of protected driver columns is not permitted';
  END IF;

  -- Network attribution: only decide_network_join() may move it.
  IF (NEW.recruited_by_commander_user_id IS DISTINCT FROM OLD.recruited_by_commander_user_id
      OR NEW.recruited_at IS DISTINCT FROM OLD.recruited_at)
     AND coalesce(current_setting('gtaxi.network_move', true), '') <> 'on' THEN
    RAISE EXCEPTION 'A driver''s network can only change through a network join request';
  END IF;

  -- Rating: only refresh_driver_rating() (fired by a rider's rating) may set it.
  IF (NEW.rating IS DISTINCT FROM OLD.rating OR NEW.rating_count IS DISTINCT FROM OLD.rating_count)
     AND coalesce(current_setting('gtaxi.rating_refresh', true), '') <> 'on' THEN
    RAISE EXCEPTION 'A driver''s rating can only change through rider ratings';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_driver_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    -- Authorises exactly this UPDATE past protect_driver_sensitive_columns;
    -- transaction-local, reset immediately after.
    PERFORM set_config('gtaxi.rating_refresh', 'on', true);
    UPDATE public.drivers d
    SET rating = sub.avg_rating,
        rating_count = sub.cnt,
        updated_at = now()
    FROM (
        SELECT ROUND(AVG(rating)::numeric, 2) AS avg_rating, COUNT(*) AS cnt
        FROM public.ratings
        WHERE driver_id = NEW.driver_id
    ) sub
    WHERE d.id = NEW.driver_id;
    PERFORM set_config('gtaxi.rating_refresh', 'off', true);
    RETURN NEW;
END;
$function$;
