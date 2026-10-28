-- =============================================================================
-- Driver cancel guard (2026-10-28). Field testing showed the driver
-- app could not cancel a ride while rider cancels worked.
--
-- The code path was traced end to end (driver ActiveTripScreen ->
-- cancel_ride edge function -> cancel_ride_atomic). Everything is
-- shared between rider and driver EXCEPT one statement that only a
-- driver cancel ever executes: the acceptance-rate penalty,
--   PERFORM public.update_driver_acceptance_rate(driver_id, false)
-- If that helper is missing or signature-drifted on the live
-- database (this repo has a documented history of function drift -
-- see the 2026-06-28 sovereign collision in AGENTS.md), the whole
-- RPC raises, the edge function returns 400, and the driver is
-- stuck on a trip they cannot leave - while rider cancels, which
-- never reach the line, keep working. Exactly the reported shape.
--
-- This migration is the Oct 15 cancel_ride_atomic definition
-- reproduced verbatim, with ONE change: the penalty now runs in
-- its own exception block. Bookkeeping failure logs a warning and
-- the cancellation proceeds. Money (the rider fee) is deliberately
-- NOT guarded - a fee failure must still fail loudly.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cancel_ride_atomic(p_ride_id uuid, p_is_rider boolean, p_is_driver boolean, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_ride RECORD;
  v_driver_user_id uuid;
  v_should_charge boolean := false;
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

  -- Rider cancellation fee (founder rule 2026-10-15): only once the driver
  -- has arrived, or has been on the way for 10+ minutes since accepting.
  -- Decided against the row locked above.
  IF p_is_rider AND v_ride.driver_id IS NOT NULL THEN
    IF v_ride.status::text = 'arrived' THEN
      v_should_charge := true;
    ELSIF v_ride.status::text = 'assigned'
          AND v_ride.assigned_at IS NOT NULL
          AND now() - v_ride.assigned_at >= interval '10 minutes' THEN
      v_should_charge := true;
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
        (v_ride.rider_id, p_ride_id, -v_fee_cents, 'cancellation_fee',
         CASE WHEN v_ride.status::text = 'arrived' THEN 'Cancelled after driver arrived'
              ELSE 'Cancelled after driver travelled 10+ minutes' END, 'completed'),
        (v_driver_user_id, p_ride_id, v_fee_cents, 'cancellation_fee', 'Compensation for rider cancellation', 'completed');
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
  -- declined acceptance against the driver's rolling acceptance_rate.
  IF p_is_driver AND v_ride.status::text IN ('assigned', 'arrived') AND v_ride.driver_id IS NOT NULL THEN
    BEGIN
      PERFORM public.update_driver_acceptance_rate(v_ride.driver_id, false);
    EXCEPTION WHEN OTHERS THEN
      -- The penalty is bookkeeping. It must never be able to block a
      -- cancellation (2026-10-28: driver cancels fail wherever this
      -- helper is missing or signature-drifted on the live database,
      -- while rider cancels - which never reach this line - keep
      -- working). Log it and let the cancellation through.
      RAISE WARNING 'cancel_ride_atomic: acceptance-rate penalty failed for driver %: %', v_ride.driver_id, SQLERRM;
    END;
  END IF;

  UPDATE public.rides
  SET status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason = v_reason,
      audit_needed_at = COALESCE(v_audit_needed_at, audit_needed_at)
  WHERE id = p_ride_id;

  -- Expire any pending offer so the driver's screen clears.
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
