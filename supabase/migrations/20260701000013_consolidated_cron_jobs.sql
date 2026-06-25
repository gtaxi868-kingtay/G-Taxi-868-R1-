-- Consolidated cron job schedule.
-- Replaces ~20 fragmented cron migrations with one honest forward-only migration.
-- Each job is unscheduled first (idempotent), then re-scheduled with the exact
-- command that runs in production.

-- 1. cleanup-driver-locations — daily 3am
SELECT cron.unschedule('cleanup-driver-locations');
SELECT cron.schedule('cleanup-driver-locations', '0 3 * * *', $$SELECT public.cleanup_driver_locations()$$);

-- 2. cleanup-rate-limit-log — hourly
SELECT cron.unschedule('cleanup-rate-limit-log');
SELECT cron.schedule('cleanup-rate-limit-log', '0 * * * *', $$SELECT public.cleanup_rate_limit_log()$$);

-- 3. daily-ai-push — daily 6am
SELECT cron.unschedule('daily-ai-push');
SELECT cron.schedule('daily-ai-push', '0 6 * * *', $$
  SELECT net.http_post(
    url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/daily_push_notifications',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
$$);

-- 4. ghost-ride-cleanup — every 2 minutes
SELECT cron.unschedule('ghost-ride-cleanup');
SELECT cron.schedule('ghost-ride-cleanup', '*/2 * * * *', $$SELECT public.cleanup_ghost_rides()$$);

-- 5. merchant-cleanup — every minute
SELECT cron.unschedule('merchant-cleanup');
SELECT cron.schedule('merchant-cleanup', '* * * * *', $$SELECT public.cleanup_merchant_appointments()$$);

-- 6. top-earner-settlement — daily midnight
SELECT cron.unschedule('top-earner-settlement');
SELECT cron.schedule('top-earner-settlement', '0 0 * * *', $$SELECT public.settle_top_earner_of_the_day()$$);

-- 7. release-expired-escape-holds — every minute
SELECT cron.unschedule('release-expired-escape-holds');
SELECT cron.schedule('release-expired-escape-holds', '* * * * *', $$SELECT public.release_expired_holds()$$);

-- 8. check-escape-tipping-points — daily 6am
SELECT cron.unschedule('check-escape-tipping-points');
SELECT cron.schedule('check-escape-tipping-points', '0 6 * * *', $$SELECT public.check_flight_tipping_points()$$);

-- 9. refresh-driver-lease-eligibility — daily 6am
SELECT cron.unschedule('refresh-driver-lease-eligibility');
SELECT cron.schedule('refresh-driver-lease-eligibility', '0 6 * * *', $$
  SELECT public.refresh_driver_lease_eligibility(d.id)
  FROM public.drivers d
  WHERE d.status = 'active'
$$);

-- 10. merchant-daily-billing — daily 6am
SELECT cron.unschedule('merchant-daily-billing');
SELECT cron.schedule('merchant-daily-billing', '0 6 * * *', $$SELECT process_merchant_billing()$$);

-- 11. sync-flight-availability-6h — every 6 hours
SELECT cron.unschedule('sync-flight-availability-6h');
SELECT cron.schedule('sync-flight-availability-6h', '0 */6 * * *', $$
  SELECT net.http_post(
    url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/sync_flight_availability',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  )
$$);

-- 12. sync-lodging-availability-6h — every 6 hours
SELECT cron.unschedule('sync-lodging-availability-6h');
SELECT cron.schedule('sync-lodging-availability-6h', '0 */6 * * *', $$
  SELECT net.http_post(
    url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/sync_lodging_availability',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  )
$$);

-- 13. auto-charge-escape-group-5min — every 5 minutes
SELECT cron.unschedule('auto-charge-escape-group-5min');
SELECT cron.schedule('auto-charge-escape-group-5min', '*/5 * * * *', $$
  SELECT net.http_post(
    url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/auto_charge_escape_group',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  )
$$);

-- 14. process-dispatch-queue-1min — every minute
SELECT cron.unschedule('process-dispatch-queue-1min');
SELECT cron.schedule('process-dispatch-queue-1min', '* * * * *', $$
  SELECT net.http_post(
    url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/process_dispatch_queue',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  )
$$);

-- 15. process-event-queue — every minute
SELECT cron.unschedule('process-event-queue');
SELECT cron.schedule('process-event-queue', '* * * * *', $$
  SELECT net.http_post(
    url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/process_event_queue',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  )
$$);

-- 16. process-settlement-grace — every 5 minutes
SELECT cron.unschedule('process-settlement-grace');
SELECT cron.schedule('process-settlement-grace', '*/5 * * * *', $$
  SELECT net.http_post(
    url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/process_settlement_grace',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  )
$$);

-- 17. platform_intelligence — every 2 minutes (with cron secret)
SELECT cron.unschedule('platform_intelligence');
SELECT cron.schedule('platform_intelligence', '*/2 * * * *', $$
  SELECT net.http_post(
    url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/platform_intelligence',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'bafa4042c7b490474331c82faefb8bdad4fd0da0d514fb5f29d4e21bc26bf01b'
    ),
    body := '{}'::jsonb
  ) as request_id;
$$);
