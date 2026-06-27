-- Consolidated pg_cron jobs (from 11 historical migrations), idempotent.
-- HONEST env-handling: pg_cron only operates in the database named by
-- cron.database_name (the platform 'postgres' DB). On an ephemeral branch
-- preview / any other DB, scheduling is skipped with a clear notice rather
-- than silently swallowed. On prod the jobs ARE created. cron.schedule upserts
-- by name (pg_cron >=1.4), so re-running is safe.
DO $cron$
BEGIN
  IF current_setting('cron.database_name', true) IS DISTINCT FROM current_database() THEN
    RAISE NOTICE 'pg_cron not operational in database %, skipping cron scheduling', current_database();
    RETURN;
  END IF;
  -- from 20260227000004_phase11_gps_retention.sql
  PERFORM cron.schedule(
    'cleanup-driver-locations',
    '0 3 * * *',
    $$SELECT public.cleanup_driver_locations()$$
);
  -- from 20260227000004_phase11_gps_retention.sql
  PERFORM cron.schedule(
    'cleanup-rate-limit-log',
    '0 * * * *',
    $$SELECT public.cleanup_rate_limit_log()$$
);
  -- from 20260325100000_driver_heartbeat.sql
  PERFORM cron.schedule('driver-heartbeat-cleanup', '*/5 * * * *', 'SELECT public.cleanup_stale_drivers()');
  -- from 20260406000002_backend_maintenance_cron.sql
  PERFORM cron.schedule('ghost-ride-cleanup', '*/2 * * * *', $$SELECT public.cleanup_ghost_rides()$$);
  -- from 20260406000002_backend_maintenance_cron.sql
  PERFORM cron.schedule('merchant-cleanup', '* * * * *', $$SELECT public.cleanup_merchant_appointments()$$);
  -- from 20260406000002_backend_maintenance_cron.sql
  PERFORM cron.schedule('top-earner-settlement', '0 0 * * *', $$SELECT public.settle_top_earner_of_the_day()$$);
  -- from 20260530000004_schedule_audit_cron.sql
  PERFORM cron.schedule(
  'audit-stripe-reconciliation',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/audit_stripe_vs_ledger',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.cron_secret', true)
    )
  ) AS request_id;
  $$
);
  -- from 20260613165331_platform_intelligence_layer.sql
  PERFORM cron.schedule(
            'platform-intelligence-15min',
            '*/15 * * * *',
            $$
            SELECT net.http_post(
                url := current_setting('app.supabase_url') || '/functions/v1/platform_intelligence',
                headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'Authorization', 'Bearer ' || current_setting('app.service_role_key')
                ),
                body := '{}'::jsonb
            )
            $$
        );
  -- from 20260614014253_gescape_flight_anchored_model.sql
  PERFORM cron.schedule(
            'release-expired-escape-holds',
            '* * * * *',
            $cron$SELECT public.release_expired_holds();
  -- from 20260614014253_gescape_flight_anchored_model.sql
  PERFORM cron.schedule(
            'check-escape-tipping-points',
            '0 6 * * *',
            $cron$SELECT public.check_flight_tipping_points();
  -- from 20260614130229_merchant_subscriptions_and_map_pins.sql
  PERFORM cron.schedule(
    'merchant-daily-billing',
    '0 6 * * *',
    $$ SELECT process_merchant_billing();
  -- from 20260617000002_titan_cron_and_rpcs.sql
  PERFORM cron.schedule(
            'process-dispatch-queue-1min',
            '* * * * *',
            $$
            SELECT net.http_post(
                url := current_setting('app.supabase_url') || '/functions/v1/process_dispatch_queue',
                headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'Authorization', 'Bearer ' || current_setting('app.service_role_key')
                ),
                body := '{}'::jsonb
            )
            $$
        );
  -- from 20260617000002_titan_cron_and_rpcs.sql
  PERFORM cron.schedule(
            'generate-b2b-invoices-monthly',
            '0 0 1 * *',
            $$
            SELECT net.http_post(
                url := current_setting('app.supabase_url') || '/functions/v1/generate_b2b_invoices',
                headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'Authorization', 'Bearer ' || current_setting('app.service_role_key')
                ),
                body := '{}'::jsonb
            )
            $$
        );
  -- from 20260618_cron_schedules_deploy.sql
  PERFORM cron.schedule(
      'sync-flight-availability-6h',
      '0 */6 * * *',
      $$SELECT net.http_post(
        url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/sync_flight_availability',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := '{}'::jsonb
      )$$
    );
  -- from 20260618_cron_schedules_deploy.sql
  PERFORM cron.schedule(
      'sync-lodging-availability-6h',
      '0 */6 * * *',
      $$SELECT net.http_post(
        url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/sync_lodging_availability',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := '{}'::jsonb
      )$$
    );
  -- from 20260618_cron_schedules_deploy.sql
  PERFORM cron.schedule(
      'auto-charge-escape-group-5min',
      '*/5 * * * *',
      $$SELECT net.http_post(
        url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/auto_charge_escape_group',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := '{}'::jsonb
      )$$
    );
  -- from 20260618_cron_schedules_deploy.sql
  PERFORM cron.schedule(
        'process-dispatch-queue-1min',
        '* * * * *',
        $$SELECT net.http_post(
          url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/process_dispatch_queue',
          headers := jsonb_build_object('Content-Type', 'application/json'),
          body := '{}'::jsonb
        )$$
      );
  -- from 20260622000002_sovereign_foundation.sql
  PERFORM cron.schedule(
      'process-event-queue-1min',
      '* * * * *',
      $$SELECT net.http_post(
        url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/process_event_queue',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := '{}'::jsonb
      )$$
    );
  -- from 20260622000002_sovereign_foundation.sql
  PERFORM cron.schedule(
      'settlement-grace-sweep-5min',
      '*/5 * * * *',
      $$SELECT public.process_settlement_grace()$$
    );
END $cron$;
