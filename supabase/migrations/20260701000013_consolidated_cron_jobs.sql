-- Consolidated pg_cron jobs — matches prod cron.job (project ffbbuafgeypvkpcuvdnv) as of 2026-06-27.
-- Pairs with 20260701000000_baseline.sql; together they ARE the migration history
-- (the old fragmented migrations are archived under supabase/migrations_archive/).
--
-- Idempotent + replay-safe:
--   * cron.schedule UPSERTs by job name (pg_cron >= 1.4) — no unschedule needed,
--     so a from-scratch replay never hits "could not find valid entry for job".
--   * Whole block is a no-op where pg_cron isn't operational (ephemeral preview /
--     clone DBs that lack the cron background worker or aren't the cron.database_name).
--
-- SECRET HYGIENE: the platform_intelligence job carries a live x-cron-secret in prod.
-- It is NOT committed here. Replace the placeholder below (or inject from vault) when
-- rebuilding a real environment. The preview/clone path skips this block entirely.

DO $cronsetup$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping cron setup';
    RETURN;
  END IF;
  IF current_setting('cron.database_name', true) IS DISTINCT FROM current_database() THEN
    RAISE NOTICE 'pg_cron not bound to % — skipping cron setup', current_database();
    RETURN;
  END IF;

  -- maintenance / cleanup
  PERFORM cron.schedule('cleanup-driver-locations', '0 3 * * *', $job$SELECT public.cleanup_driver_locations()$job$);
  PERFORM cron.schedule('cleanup-rate-limit-log',   '0 * * * *', $job$SELECT public.cleanup_rate_limit_log()$job$);
  PERFORM cron.schedule('ghost-ride-cleanup',       '*/2 * * * *', $job$SELECT public.cleanup_ghost_rides()$job$);
  PERFORM cron.schedule('merchant-cleanup',         '* * * * *', $job$SELECT public.cleanup_merchant_appointments()$job$);

  -- settlement / billing / lease
  PERFORM cron.schedule('top-earner-settlement',           '0 0 * * *', $job$SELECT public.settle_top_earner_of_the_day()$job$);
  PERFORM cron.schedule('merchant-daily-billing',          '0 6 * * *', $job$SELECT process_merchant_billing()$job$);
  PERFORM cron.schedule('refresh-driver-lease-eligibility','0 6 * * *', $job$SELECT public.refresh_driver_lease_eligibility(d.id) FROM public.drivers d WHERE d.status = 'active'$job$);

  -- escape / travel
  PERFORM cron.schedule('check-escape-tipping-points',  '0 6 * * *', $job$SELECT public.check_flight_tipping_points()$job$);
  PERFORM cron.schedule('release-expired-escape-holds', '* * * * *', $job$SELECT public.release_expired_holds()$job$);
  PERFORM cron.schedule('auto-charge-escape-group-5min','*/5 * * * *', $job$SELECT net.http_post(url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/auto_charge_escape_group', headers := jsonb_build_object('Content-Type','application/json'), body := '{}'::jsonb)$job$);
  PERFORM cron.schedule('sync-flight-availability-6h',  '0 */6 * * *', $job$SELECT net.http_post(url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/sync_flight_availability', headers := jsonb_build_object('Content-Type','application/json'), body := '{}'::jsonb)$job$);
  PERFORM cron.schedule('sync-lodging-availability-6h', '0 */6 * * *', $job$SELECT net.http_post(url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/sync_lodging_availability', headers := jsonb_build_object('Content-Type','application/json'), body := '{}'::jsonb)$job$);

  -- dispatch / queues
  PERFORM cron.schedule('process-dispatch-queue-1min', '* * * * *', $job$SELECT net.http_post(url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/process_dispatch_queue', headers := jsonb_build_object('Content-Type','application/json'), body := '{}'::jsonb)$job$);
  PERFORM cron.schedule('process-event-queue',         '* * * * *', $job$SELECT net.http_post(url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/process_event_queue', headers := jsonb_build_object('Content-Type','application/json'), body := '{}'::jsonb)$job$);
  PERFORM cron.schedule('process-settlement-grace',    '*/5 * * * *', $job$SELECT net.http_post(url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/process_settlement_grace', headers := jsonb_build_object('Content-Type','application/json'), body := '{}'::jsonb)$job$);

  -- AI / notifications
  PERFORM cron.schedule('daily-ai-push', '0 6 * * *', $job$SELECT net.http_post(url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/daily_push_notifications', headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb)$job$);
  -- NOTE: replace <<X_CRON_SECRET>> with the live secret (or vault ref) for real rebuilds.
  PERFORM cron.schedule('platform_intelligence', '*/2 * * * *', $job$SELECT net.http_post(url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/platform_intelligence', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<<X_CRON_SECRET>>'), body := '{}'::jsonb)$job$);
END
$cronsetup$;
