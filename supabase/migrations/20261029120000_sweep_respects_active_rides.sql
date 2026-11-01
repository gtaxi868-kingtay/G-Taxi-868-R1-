-- ═══════════════════════════════════════════════════════════════════
-- The stale-driver sweep must never throw a driver offline mid-trip.
--
-- sweep_stale_online_drivers() (20261015450000, redefined 20261018120000)
-- flips any online driver to is_online = false, status = 'offline' when
-- their last ping/heartbeat is 15+ minutes old. Its only trip protection
-- is `active_ride_id IS NULL` -- but nothing in the accept path ever
-- writes drivers.active_ride_id (accept_ride does not set it; the only
-- writer in the codebase is the NFC event handler). The guard therefore
-- never fires, and a driver whose app stops pinging mid-trip -- e.g.
-- backgrounded on the same phone while the rider side is used, exactly
-- the pilot's one-phone test setup -- is swept offline while he still
-- has a rider in the car. When the ride is then cancelled he lands on a
-- Dashboard that says offline, with no explanation, and dispatch stops
-- offering him trips (matching requires is_online AND status='online').
--
-- Fix: judge "on a trip" from the rides table, the source of truth --
-- a driver with a ride in assigned / arrived / in_progress is never
-- swept, however old his last ping is. Everything else (15-minute
-- staleness, the analytics cause marker, grants) is unchanged from the
-- 20261018120000 definition.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sweep_stale_online_drivers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  n integer;
BEGIN
  PERFORM set_config('gtaxi.offline_cause', 'stale', true);
  UPDATE public.drivers d
     SET is_online = false, status = 'offline'
   WHERE d.is_online = true
     AND d.active_ride_id IS NULL
     AND NOT EXISTS (
           SELECT 1 FROM public.rides r
            WHERE r.driver_id = d.id
              AND r.status IN ('assigned', 'arrived', 'in_progress'))
     AND COALESCE(GREATEST(d.last_seen, d.last_location_update), 'epoch'::timestamptz) < now() - interval '15 minutes';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('gtaxi.offline_cause', '', true);
  RETURN n;
END;
$function$;
REVOKE ALL ON FUNCTION public.sweep_stale_online_drivers() FROM PUBLIC, anon, authenticated;
