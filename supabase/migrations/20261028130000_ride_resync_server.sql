-- Ride resync, server half (2026-10-28).
--
-- Two backstops for the night a driver's phone dies mid-trip:
--
-- 1. Every location ping is stamped with the driver's active ride. Until
--    now the pings carried no ride id, so a trip had no location trail —
--    nothing to replay for a safety dispute. The stamp happens on insert,
--    here in the database, so every app version benefits.
--
-- 2. cleanup_stale_trips(): a janitor for started trips that have gone
--    silent. cleanup_ghost_rides only sweeps trips that never started
--    (requested/searching), so a started trip whose phone went dark sat
--    open forever and locked both accounts. A trip counts as stale only
--    when BOTH the trip has not moved AND the driver's phone has sent no
--    ping for the whole stretch — either signal alone is not enough (a
--    parked driver on a long trip still pings; a phone can stop pinging
--    while its trip screen is alive). Past the flag mark the trip is
--    reported; past the close mark it is cancelled through
--    admin_update_ride_status, the same path an admin uses by hand, so
--    the event trail reads exactly like a manual close. Runs hourly.

-- 1. Stamp each ping with the active ride -----------------------------------

CREATE OR REPLACE FUNCTION public.stamp_driver_location_ride()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.ride_id IS NULL THEN
        SELECT r.id INTO NEW.ride_id
        FROM public.rides r
        WHERE r.driver_id = NEW.driver_id
          AND r.status IN ('assigned', 'arrived', 'in_progress')
        ORDER BY r.updated_at DESC
        LIMIT 1;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_driver_location_ride ON public.driver_locations;
CREATE TRIGGER trg_stamp_driver_location_ride
    BEFORE INSERT ON public.driver_locations
    FOR EACH ROW EXECUTE FUNCTION public.stamp_driver_location_ride();

-- 2. The stale-trip janitor ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.cleanup_stale_trips(
    p_flag_after interval DEFAULT '2 hours',
    p_close_after interval DEFAULT '12 hours',
    p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_flagged uuid[] := '{}';
    v_closed uuid[] := '{}';
    v_ride record;
BEGIN
    FOR v_ride IN
        SELECT r.id, r.updated_at,
               (SELECT max(dl.created_at)
                  FROM public.driver_locations dl
                 WHERE dl.driver_id = r.driver_id) AS last_ping
        FROM public.rides r
        WHERE r.status = 'in_progress'
    LOOP
        IF v_ride.updated_at < now() - p_flag_after
           AND (v_ride.last_ping IS NULL OR v_ride.last_ping < now() - p_flag_after) THEN
            v_flagged := array_append(v_flagged, v_ride.id);

            IF NOT p_dry_run
               AND v_ride.updated_at < now() - p_close_after
               AND (v_ride.last_ping IS NULL OR v_ride.last_ping < now() - p_close_after) THEN
                BEGIN
                    IF public.admin_update_ride_status(v_ride.id, 'cancelled') THEN
                        v_closed := array_append(v_closed, v_ride.id);
                    END IF;
                EXCEPTION WHEN OTHERS THEN
                    -- One bad row must not stop the sweep.
                    NULL;
                END;
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'dry_run', p_dry_run,
        'flagged', to_jsonb(v_flagged),
        'closed', to_jsonb(v_closed)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_stale_trips(interval, interval, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_trips(interval, interval, boolean) TO service_role;

-- Hourly, at quarter past — clear of the ghost-ride sweep's own cadence.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cleanup-stale-trips';
        PERFORM cron.schedule('cleanup-stale-trips', '15 * * * *', 'SELECT public.cleanup_stale_trips()');
    END IF;
END;
$$;
