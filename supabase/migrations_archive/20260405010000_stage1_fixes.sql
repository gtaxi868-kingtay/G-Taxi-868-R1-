-- Stage 1 Fix 1: Surcharge decimal precision handling
-- Ensures that weight-based surcharges are always rounded to the nearest cent
CREATE OR REPLACE FUNCTION public.calculate_order_surcharge(p_weight_kg double precision)
RETURNS integer LANGUAGE plpgsql AS $$
BEGIN
    RETURN ROUND(p_weight_kg * 100)::integer; -- 100 cents per KG
END;
$$;

-- Stage 1 Fix 2: Gate ScheduledRides behind feature flag
INSERT INTO system_feature_flags (id, is_active, description)
VALUES ('scheduled_rides_enabled', false, 'Driver scheduled rides feature. Enable when backend scheduling engine is built.')
ON CONFLICT (id) DO NOTHING;

-- Stage 1 Fix 3: Realtime Event Logging Trigger
-- Ensures that every status change is logged for audit trails
CREATE OR REPLACE FUNCTION public.log_status_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (OLD.status IS DISTINCT FROM NEW.status) THEN
        INSERT INTO public.ride_events (ride_id, event_type, metadata)
        VALUES (NEW.id, 'STATUS_CHANGE', jsonb_build_object('from', OLD.status, 'to', NEW.status));
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_log_status_change ON public.rides;
CREATE TRIGGER tr_log_status_change
    AFTER UPDATE ON public.rides
    FOR EACH ROW EXECUTE FUNCTION public.log_status_change();

-- Stage 1 Fix 4: Demand Indicator RPC
CREATE OR REPLACE FUNCTION get_demand_hint(
  p_driver_lat double precision,
  p_driver_lng double precision
)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_nearby_searching integer;
BEGIN
  -- Count rides searching within 10km of driver
  SELECT COUNT(*) INTO v_nearby_searching
  FROM rides
  WHERE status IN ('searching', 'waiting_queue')
  AND created_at > NOW() - INTERVAL '5 minutes'
  AND (
    6371 * acos(
      LEAST(1.0, cos(radians(p_driver_lat)) * cos(radians(pickup_lat)) *
      cos(radians(pickup_lng) - radians(p_driver_lng)) +
      sin(radians(p_driver_lat)) * sin(radians(pickup_lat)))
    )
  ) < 10;

  IF v_nearby_searching >= 3 THEN
    RETURN 'HIGH DEMAND nearby — ' || v_nearby_searching || ' riders searching';
  ELSIF v_nearby_searching >= 1 THEN
    RETURN v_nearby_searching || ' rider' || CASE WHEN v_nearby_searching = 1 THEN '' ELSE 's' END || ' searching near you';
  ELSE
    RETURN 'Quiet right now — try POS or Chaguanas';
  END IF;
END;
$$;
