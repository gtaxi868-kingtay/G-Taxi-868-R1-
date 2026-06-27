-- 20260618_cron_schedules_deploy.sql
-- Deploy missing cron schedules for sync and auto-charge edge functions.
-- Requires: pg_cron extension, pg_net extension, net.http_post helper.
-- Dashboard config required: none (URL hardcoded; functions use conditional auth).
--
-- Schedules:
--   sync-flight-availability-6h   — Poll Amadeus Flight Offers API every 6h
--   sync-lodging-availability-6h  — Poll Booking.com XML API every 6h
--   auto-charge-escape-group-5min — Charge participants when tipping point hit
--   process-dispatch-queue-1min   — Already created in 20260617000002 (verified)
--
-- Edge function auth strategy:
--   No Authorization header passed. Functions use conditional auth:
--     sync_lodging_availability   — skips JWT when no header (ready)
--     auto_charge_escape_group    — skips JWT when no header (ready)
--     sync_flight_availability    — refactored 2026-06-18 to conditional pattern
--     process_dispatch_queue      — no auth guard (runs as service role)

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN

    -- ── sync_flight_availability: every 6 hours ────────────────
    DO $cronguard$ BEGIN
      IF current_setting('cron.database_name', true) IS NOT DISTINCT FROM current_database() THEN
        PERFORM cron.unschedule('sync-flight-availability-6h');
      ELSE
        RAISE NOTICE 'pg_cron not operational in % — skipping cron op', current_database();
      END IF;
    END $cronguard$;
    DO $cronguard$ BEGIN
      IF current_setting('cron.database_name', true) IS NOT DISTINCT FROM current_database() THEN
        PERFORM cron.schedule(
      'sync-flight-availability-6h',
      '0 */6 * * *',
      $$SELECT net.http_post(
        url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/sync_flight_availability',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := '{}'::jsonb
      )$$
    );
      ELSE
        RAISE NOTICE 'pg_cron not operational in % — skipping cron op', current_database();
      END IF;
    END $cronguard$;

    -- ── sync_lodging_availability: every 6 hours ───────────────
    DO $cronguard$ BEGIN
      IF current_setting('cron.database_name', true) IS NOT DISTINCT FROM current_database() THEN
        PERFORM cron.unschedule('sync-lodging-availability-6h');
      ELSE
        RAISE NOTICE 'pg_cron not operational in % — skipping cron op', current_database();
      END IF;
    END $cronguard$;
    DO $cronguard$ BEGIN
      IF current_setting('cron.database_name', true) IS NOT DISTINCT FROM current_database() THEN
        PERFORM cron.schedule(
      'sync-lodging-availability-6h',
      '0 */6 * * *',
      $$SELECT net.http_post(
        url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/sync_lodging_availability',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := '{}'::jsonb
      )$$
    );
      ELSE
        RAISE NOTICE 'pg_cron not operational in % — skipping cron op', current_database();
      END IF;
    END $cronguard$;

    -- ── auto_charge_escape_group: every 5 minutes ──────────────
    DO $cronguard$ BEGIN
      IF current_setting('cron.database_name', true) IS NOT DISTINCT FROM current_database() THEN
        PERFORM cron.unschedule('auto-charge-escape-group-5min');
      ELSE
        RAISE NOTICE 'pg_cron not operational in % — skipping cron op', current_database();
      END IF;
    END $cronguard$;
    DO $cronguard$ BEGIN
      IF current_setting('cron.database_name', true) IS NOT DISTINCT FROM current_database() THEN
        PERFORM cron.schedule(
      'auto-charge-escape-group-5min',
      '*/5 * * * *',
      $$SELECT net.http_post(
        url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/auto_charge_escape_group',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := '{}'::jsonb
      )$$
    );
      ELSE
        RAISE NOTICE 'pg_cron not operational in % — skipping cron op', current_database();
      END IF;
    END $cronguard$;

    -- ── process_dispatch_queue: confirm existing cron ──────────
    -- Already created in 20260617000002 as process-dispatch-queue-1min
    -- If missing (branch reset), re-create every minute
    IF NOT EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'process-dispatch-queue-1min'
    ) THEN
      DO $cronguard$ BEGIN
        IF current_setting('cron.database_name', true) IS NOT DISTINCT FROM current_database() THEN
          PERFORM cron.schedule(
        'process-dispatch-queue-1min',
        '* * * * *',
        $$SELECT net.http_post(
          url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/process_dispatch_queue',
          headers := jsonb_build_object('Content-Type', 'application/json'),
          body := '{}'::jsonb
        )$$
      );
        ELSE
          RAISE NOTICE 'pg_cron not operational in % — skipping cron op', current_database();
        END IF;
      END $cronguard$;
    END IF;

  END IF;
END;
$$;
