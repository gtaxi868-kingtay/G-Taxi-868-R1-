-- ═══════════════════════════════════════════════════════════════════
-- Price a return trip at two one-way fares.
--
-- escape_lane_fare_baseline holds ONE-WAY fares (its own source column
-- says so: "Caribbean Airlines public fare search -- one-way"). This
-- trigger copied that number straight onto every flight block, so a
-- package with a return leg -- which every Escape package has -- was
-- costed with half its flights. Packages made from the admin Escape form
-- were under-priced by a full one-way fare per person (TTD 442 on
-- POS-TAB, TTD 2,713 on POS-ANU), coming straight out of margin.
--
-- Now: return_time set -> 2 x one-way; one-way block -> 1 x. An explicit
-- researched flight_cost_per_seat_cents still wins (G's proposer passes
-- round-trip explicitly, so it is unaffected). flight_cache is untouched:
-- it is empty and its fare semantics are not defined yet.
--
-- Insert-only trigger: existing blocks are not re-priced.
-- Dry-run (rolled back, as a real admin JWT): round trip -> 88400,
-- one-way -> 44200, explicit 88400 -> 88400.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sync_flight_block_real_cost()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_cache_fare integer;
  v_baseline_fare integer;
BEGIN
  IF NEW.flight_cost_per_seat_cents IS NOT NULL AND NEW.flight_cost_per_seat_cents > 0 THEN
    RETURN NEW;
  END IF;

  SELECT fare_cents INTO v_cache_fare
  FROM public.flight_cache
  WHERE origin_code = NEW.origin_code AND destination_code = NEW.destination_code
    AND expires_at > now()
  ORDER BY fetched_at DESC LIMIT 1;

  IF v_cache_fare IS NOT NULL THEN
    NEW.flight_cost_per_seat_cents := v_cache_fare;
    RETURN NEW;
  END IF;

  SELECT fare_cents INTO v_baseline_fare
  FROM public.escape_lane_fare_baseline
  WHERE origin_code = NEW.origin_code AND destination_code = NEW.destination_code AND is_active;

  IF v_baseline_fare IS NOT NULL THEN
    -- Baselines are one-way; a block with a return leg costs two.
    NEW.flight_cost_per_seat_cents := v_baseline_fare * CASE WHEN NEW.return_time IS NOT NULL THEN 2 ELSE 1 END;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'No real fare source (flight_cache or escape_lane_fare_baseline) for lane % -> %. Add a baseline row or pass an explicit researched flight_cost_per_seat_cents.', NEW.origin_code, NEW.destination_code;
END;
$function$;
