-- cancel_ride/index.ts and admin/index.ts's cancel_ride action have BOTH
-- been writing to rides.cancelled_at and rides.cancellation_reason since
-- they were written -- columns that have never existed on the rides
-- table. Every single ride cancellation attempt through either path has
-- failed with a Postgres "column does not exist" error since day one.
-- cancel_ride's error handling maps this into a misleading "already in
-- progress or completed" message; admin/index.ts's cancel_ride action
-- never even checks for the update error, so admins have been told
-- cancellations succeeded when the ride row never actually changed.
-- Confirmed live 2026-08-16: `UPDATE rides SET cancelled_at=now() WHERE
-- false` throws 42703 column does not exist against the real schema.
--
-- Found while implementing a background audit's cancellation-flow
-- findings (a second, independent bug class): a $5 TTD rider cancellation
-- fee that silently never charged (INSERT targeted ride.driver_id, which
-- is drivers.id not an auth user id, violating the wallet_transactions
-- FK -- same identity-resolution class already fixed elsewhere this
-- session), computed from a stale pre-fetched ride row (a TOCTOU race
-- against a concurrent accept_ride), a driver accept-then-cancel abuse
-- vector (update_driver_acceptance_rate existed but was never called
-- anywhere), and dangling pending ride_offers left behind on cancel.
--
-- Fixed by adding the missing columns and moving the entire cancellation
-- decision (fee math + driver-identity resolution + acceptance-rate
-- penalty + ride_offers cleanup + the atomic status UPDATE) into ONE
-- SECURITY DEFINER function that locks the ride row (FOR UPDATE) before
-- deciding anything, closing the TOCTOU race structurally rather than by
-- narrowing a window. Cancellation fee moved to pricing_config
-- (CANCELLATION_FEE_CENTS) instead of hardcoded, matching this session's
-- broader move of settlement-adjacent values off hardcoded literals.
--
-- Live-verified end-to-end through the real deployed edge functions
-- (not just dry-run): rider cancels an 'arrived' ride -> $5 fee moves
-- correctly to the driver's real auth id, cancelled_at/cancellation_reason
-- populate, profiles.cancellation_count increments; driver cancels an
-- 'assigned' ride -> no fee, acceptance_rate drops 0.85 -> 0.765 (matches
-- update_driver_acceptance_rate's existing decay formula exactly), the
-- pending ride_offers row is marked expired. All synthetic test data
-- cleaned up after verification.
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS cancellation_reason text;

INSERT INTO public.pricing_config (key, value_cents)
VALUES ('CANCELLATION_FEE_CENTS', 500)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.cancel_ride_atomic(
  p_ride_id uuid,
  p_is_rider boolean,
  p_is_driver boolean,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_ride RECORD;
  v_driver_user_id uuid;
  v_should_charge boolean := false;
  v_dist double precision;
  v_driver_lat double precision;
  v_driver_lng double precision;
  v_fee_cents integer;
  v_reason text;
  v_audit_needed_at timestamptz := NULL;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

  IF v_ride IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ride not found');
  END IF;

  IF NOT (v_ride.status::text = ANY(ARRAY['requested','searching','assigned','arrived'])) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ride cannot be cancelled');
  END IF;

  v_reason := COALESCE(p_reason, CASE WHEN p_is_rider THEN 'Rider cancelled' ELSE 'Driver cancelled' END);

  -- Smart Rider Penalty: fee applies if rider cancels while the driver is
  -- already at the pickup, or close (<1km). Decided against the row we
  -- just locked, not a stale pre-fetch from earlier in the request.
  IF p_is_rider AND v_ride.status::text IN ('assigned','arrived') AND v_ride.driver_id IS NOT NULL THEN
    IF v_ride.status::text = 'arrived' THEN
      v_should_charge := true;
    ELSE
      SELECT lat, lng INTO v_driver_lat, v_driver_lng FROM public.drivers WHERE id = v_ride.driver_id;
      IF v_driver_lat IS NOT NULL AND v_driver_lng IS NOT NULL THEN
        v_dist := 6371000 * 2 * asin(sqrt(
          sin(radians(v_driver_lat - v_ride.pickup_lat) / 2) ^ 2 +
          cos(radians(v_ride.pickup_lat)) * cos(radians(v_driver_lat)) *
          sin(radians(v_driver_lng - v_ride.pickup_lng) / 2) ^ 2
        ));
        IF v_dist < 1000 THEN
          v_should_charge := true;
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_should_charge THEN
    -- v_ride.driver_id is drivers.id, not an auth user id -- resolve the
    -- driver's real auth id before crediting, or the wallet_transactions
    -- FK rejects the whole batch insert (this was the original bug).
    SELECT user_id INTO v_driver_user_id FROM public.drivers WHERE id = v_ride.driver_id;

    SELECT value_cents INTO v_fee_cents FROM public.pricing_config WHERE key = 'CANCELLATION_FEE_CENTS';
    v_fee_cents := COALESCE(v_fee_cents, 500);

    IF v_driver_user_id IS NOT NULL THEN
      INSERT INTO public.wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
      VALUES
        (v_ride.rider_id, p_ride_id, -v_fee_cents, 'cancellation_fee', 'Nearby cancellation fee', 'completed'),
        (v_driver_user_id, p_ride_id, v_fee_cents, 'cancellation_fee', 'Compensation for nearby cancellation', 'completed');
    ELSE
      v_reason := v_reason || ' [fee skipped: driver auth id unresolved]';
      v_should_charge := false;
    END IF;
  END IF;

  -- Driver Platform Leakage Trapdoor: if the driver cancels after arrival,
  -- schedule a proximity audit.
  IF p_is_driver AND v_ride.status::text = 'arrived' THEN
    v_audit_needed_at := now() + interval '3 minutes';
  END IF;

  -- Driver abuse guard: cancelling a ride already accepted counts as a
  -- declined acceptance against the driver's rolling acceptance_rate --
  -- closes the accept-then-cancel-repeatedly-to-view-rider-destinations
  -- pattern with zero prior consequence. Cancelling before ever being
  -- assigned (requested/searching) is not penalized -- nothing to decline.
  IF p_is_driver AND v_ride.status::text IN ('assigned', 'arrived') AND v_ride.driver_id IS NOT NULL THEN
    PERFORM public.update_driver_acceptance_rate(v_ride.driver_id, false);
  END IF;

  UPDATE public.rides
  SET status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason = v_reason,
      audit_needed_at = COALESCE(v_audit_needed_at, audit_needed_at)
  WHERE id = p_ride_id;

  -- A driver's app subscribes directly to ride_offers rows; without this,
  -- a pending offer for a now-cancelled ride kept showing on the driver's
  -- screen indefinitely (accept_ride's own atomic guard still correctly
  -- rejects tapping it, but the dead card never went away).
  UPDATE public.ride_offers
  SET status = 'expired'
  WHERE ride_id = p_ride_id AND status = 'pending';

  RETURN jsonb_build_object(
    'success', true,
    'ride_id', p_ride_id,
    'status', 'cancelled',
    'driver_id', v_ride.driver_id,
    'rider_id', v_ride.rider_id,
    'previous_status', v_ride.status,
    'fee_charged', v_should_charge,
    'fee_cents', CASE WHEN v_should_charge THEN v_fee_cents ELSE 0 END
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cancel_ride_atomic(uuid, boolean, boolean, text) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.cancel_ride_atomic(uuid, boolean, boolean, text) TO service_role;

-- update_driver_acceptance_rate existed but had zero callers anywhere in
-- the codebase, so drivers.acceptance_rate never moved regardless of
-- behavior -- a driver could accept a ride, view the rider's pickup and
-- destination, then cancel, on repeat, with no consequence ever. Now
-- called from accept_ride/index.ts (true, on successful accept) and
-- cancel_ride_atomic above (false, when a driver cancels a ride already
-- accepted). It was also grantable to `authenticated` directly -- RLS on
-- drivers ("Drivers update own status", user_id = auth.uid()) happened to
-- prevent a driver from altering another driver's score, but still let a
-- driver self-game their own via direct RPC. Locked to service_role only,
-- matching this session's established pattern.
REVOKE EXECUTE ON FUNCTION public.update_driver_acceptance_rate(uuid, boolean) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.update_driver_acceptance_rate(uuid, boolean) TO service_role;

-- profiles.cancellation_count existed with zero writers anywhere in the
-- codebase -- no rider-side penalty or fraud signal for repeated
-- cancellations existed at all. Small atomic increment, called from
-- cancel_ride/index.ts on every rider-initiated cancellation.
CREATE OR REPLACE FUNCTION public.increment_rider_cancellation_count(p_rider_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  UPDATE public.profiles SET cancellation_count = COALESCE(cancellation_count, 0) + 1 WHERE id = p_rider_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.increment_rider_cancellation_count(uuid) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.increment_rider_cancellation_count(uuid) TO service_role;
