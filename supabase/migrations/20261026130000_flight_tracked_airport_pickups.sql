-- Airport pickups that follow the real flight (FlightAware AeroAPI).
--
-- WHY: a hotel booking a guest's Piarco or Tobago pickup needs the driver
-- there when the guest walks out, not when the plane was scheduled. Caribbean
-- Airlines' own US ground-transport partner offers exactly this ("flight
-- monitoring"); it is the first gap to close before any airline conversation.
--
-- WHAT:
--  1. airline_flights (existing, 0 rows) becomes the flight-status cache:
--     one row per flight number per local date, so each flight is fetched
--     from AeroAPI (billed per query) once per refresh, however many guests
--     are on it.
--  2. A cron job every 10 minutes asks sync_flight_availability (mode
--     refresh_flight_pickups) to refresh flights with a pickup in the next
--     18 hours and move each pickup to the new arrival time. Secret read via
--     public.platform_cron_secret(), never inlined.

-- 1 ---------------------------------------------------------------------------
ALTER TABLE public.airline_flights
    ADD COLUMN IF NOT EXISTS flight_date date,
    ADD COLUMN IF NOT EXISTS origin text,
    ADD COLUMN IF NOT EXISTS destination text,
    ADD COLUMN IF NOT EXISTS scheduled_in timestamptz,
    ADD COLUMN IF NOT EXISTS estimated_in timestamptz,
    ADD COLUMN IF NOT EXISTS actual_in timestamptz,
    ADD COLUMN IF NOT EXISTS cancelled boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS diverted boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS fetched_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS airline_flights_number_date_key
    ON public.airline_flights (flight_number, flight_date);

-- Rides waiting on a flight are found by this metadata key.
CREATE INDEX IF NOT EXISTS rides_scheduled_flight_idx
    ON public.rides ((metadata->>'flight_number'))
    WHERE status = 'scheduled' AND metadata ? 'flight_number';

-- 2 ---------------------------------------------------------------------------
DO $$
BEGIN
    PERFORM cron.unschedule('refresh-flight-pickups-10min')
      FROM cron.job WHERE jobname = 'refresh-flight-pickups-10min';
    PERFORM cron.schedule(
        'refresh-flight-pickups-10min',
        '*/10 * * * *',
        $cmd$
        SELECT net.http_post(
            url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/sync_flight_availability',
            headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', public.platform_cron_secret()),
            body := '{"mode":"refresh_flight_pickups"}'::jsonb
        );
        $cmd$
    );
END $$;
