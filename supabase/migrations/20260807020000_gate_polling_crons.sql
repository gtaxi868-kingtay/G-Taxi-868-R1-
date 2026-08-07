-- ═══════════════════════════════════════════════════════════════════════════
-- STOP THE MINUTE-POLLERS BURNING INVOCATIONS ON AN EMPTY QUEUE
-- (2026-08-07)
--
-- Three jobs fired unconditionally on a fixed schedule — 2880 calls in two
-- days each for the once-a-minute pair — regardless of whether there was a
-- single row to process. There was not: dispatch_queue, event_queue and
-- wipay_sessions all had ZERO pending rows, so effectively every invocation
-- was billed and did nothing.
--
-- Two were worse than idle. process_dispatch_queue 500s on its FIRST query
-- (selects merchants.business_name; the column is `name`) and
-- process_pending_wipay_settlements 500s on its first query too (selects
-- wipay_sessions.amount_cents, which does not exist at all — the amount is
-- inside form_fields). 430 failed, billed calls in six hours doing nothing.
--
-- The TypeScript fixes are committed alongside this but CANNOT BE DEPLOYED:
-- the project is at its edge-function cap and every deploy returns 402. So
-- this gate is the fix available today — and it is worth keeping permanently
-- either way:
--   * an empty queue costs one cheap local EXISTS, not an HTTP request
--   * the instant a row appears the job fires exactly as before
--   * nothing is disabled and no behaviour is lost
--
-- The secret now resolves through public.platform_cron_secret() (Vault)
-- rather than being re-embedded as a plaintext literal, which is how the
-- other 18 jobs still carry it. Verified byte-identical to the live value
-- before applying.
-- ═══════════════════════════════════════════════════════════════════════════

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'process-dispatch-queue-1min'),
  command := $cmd$
    SELECT net.http_post(
        url     := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/process_dispatch_queue',
        headers := jsonb_build_object('Content-Type','application/json',
                                      'x-cron-secret', public.platform_cron_secret()),
        body    := '{}'::jsonb)
     WHERE EXISTS (SELECT 1 FROM public.dispatch_queue
                    WHERE status = 'pending' AND attempts < 5);
  $cmd$);

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'process-event-queue'),
  command := $cmd$
    SELECT net.http_post(
        url     := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/process_event_queue',
        headers := jsonb_build_object('Content-Type','application/json',
                                      'x-cron-secret', public.platform_cron_secret()),
        body    := '{}'::jsonb)
     WHERE EXISTS (SELECT 1 FROM public.event_queue WHERE status = 'pending');
  $cmd$);

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'process-pending-wipay-settlements'),
  command := $cmd$
    SELECT net.http_post(
        url     := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/process_pending_wipay_settlements',
        headers := jsonb_build_object('Content-Type','application/json',
                                      'x-cron-secret', public.platform_cron_secret()),
        body    := '{}'::jsonb)
     WHERE EXISTS (SELECT 1 FROM public.wipay_sessions WHERE status = 'pending_resolution');
  $cmd$);
