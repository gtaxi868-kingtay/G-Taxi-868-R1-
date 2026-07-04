-- Fraud + safety detection at the DB layer (drift-proof: fires regardless of
-- which edge-function version performs the ride transition).
-- =========================================================================
-- Gap 2 — Same-pair velocity / collusion flag:
--   A driver + a friend-rider could farm sign-up/surge bonuses with repeated
--   "rides". When a ride is ASSIGNED, count how many rides this exact
--   rider+driver pair have completed in the last 24h. On the 4th+ we FLAG
--   (never block — a rider legitimately loves one driver) so bonus/payout
--   logic and admins can review. Recorded in ride_events + rides.metadata.
--
-- Gap 3 — Cancel-while-in-transit safety alert:
--   If a ride is cancelled while it was already in_progress, the rider was
--   in the car — a genuine safety signal. We log a safety event immediately
--   (admin RescueScreen / Support can surface it). Simpler and less noisy
--   than GPS-motion heuristics: pickup-then-cancel is the real risk.
-- =========================================================================

-- ── Gap 2: pair-velocity collusion flag ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_flag_pair_velocity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pair_count integer;
  v_threshold  integer := 3;  -- 3 prior completed in 24h → the 4th is flagged
BEGIN
  IF NEW.status = 'assigned'
     AND (OLD.status IS DISTINCT FROM 'assigned')
     AND NEW.driver_id IS NOT NULL
     AND NEW.rider_id IS NOT NULL THEN

    SELECT count(*) INTO v_pair_count
    FROM public.rides r
    WHERE r.rider_id = NEW.rider_id
      AND r.driver_id = NEW.driver_id
      AND r.id <> NEW.id
      AND r.status IN ('completed', 'payment_confirmed', 'closed')
      AND COALESCE(r.completed_at, r.updated_at) > now() - interval '24 hours';

    IF v_pair_count >= v_threshold THEN
      NEW.metadata = COALESCE(NEW.metadata, '{}'::jsonb)
        || jsonb_build_object('collusion_review', true, 'pair_ride_count_24h', v_pair_count);

      INSERT INTO public.ride_events (ride_id, event_type, actor_type, metadata)
      VALUES (
        NEW.id, 'collusion_velocity_flag', 'system',
        jsonb_build_object(
          'rider_id', NEW.rider_id,
          'driver_id', NEW.driver_id,
          'pair_ride_count_24h', v_pair_count,
          'threshold', v_threshold
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_flag_pair_velocity ON public.rides;
CREATE TRIGGER trg_flag_pair_velocity
  BEFORE UPDATE OF status ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_flag_pair_velocity();

-- ── Gap 3: cancel-while-in-transit safety alert ──────────────────────────
CREATE OR REPLACE FUNCTION public.trg_safety_cancel_in_transit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status = 'in_progress' THEN
    INSERT INTO public.ride_events (ride_id, event_type, actor_type, metadata)
    VALUES (
      NEW.id, 'safety_cancel_in_transit', 'system',
      jsonb_build_object(
        'rider_id', NEW.rider_id,
        'driver_id', NEW.driver_id,
        'note', 'Ride cancelled after pickup (was in_progress) — review for rider safety',
        'pickup_lat', NEW.pickup_lat
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_safety_cancel_in_transit ON public.rides;
CREATE TRIGGER trg_safety_cancel_in_transit
  AFTER UPDATE OF status ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_safety_cancel_in_transit();
