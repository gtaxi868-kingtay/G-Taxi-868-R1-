-- ═══════════════════════════════════════════════════════════════════
-- Rider cancellation fee: founder's rule (2026-10-15).
--
-- "Grace should be when driver has traveled 10 minutes to a rider or they
--  cancel after the driver has arrived at their location."
--
-- Before: the TT$5 fee applied whenever the assigned driver was within 1 km
-- of pickup -- including a cancel 3 seconds after a nearby driver accepted.
--
-- After: a rider who cancels pays the fee only if
--   (a) the driver has ARRIVED, or
--   (b) the driver accepted 10 or more minutes ago (has been travelling).
-- Otherwise cancelling is free. If the accept time is unknown, no fee.
--
-- rides.assigned_at (new) is stamped by a trigger the moment a ride moves
-- into 'assigned', whatever path assigns it (accept_ride, dispatch, admin).
-- The trigger only fires on that transition (see the 2026-06-20 lesson:
-- unguarded rides triggers broke every rides UPDATE).
-- Everything else in cancel_ride_atomic is unchanged.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

CREATE OR REPLACE FUNCTION public.stamp_ride_assigned_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.status::text = 'assigned'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    NEW.assigned_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_stamp_ride_assigned_at ON public.rides;
CREATE TRIGGER trg_stamp_ride_assigned_at
  BEFORE INSERT OR UPDATE OF status ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.stamp_ride_assigned_at();

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
    PERFORM public.update_driver_acceptance_rate(v_ride.driver_id, false);
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
