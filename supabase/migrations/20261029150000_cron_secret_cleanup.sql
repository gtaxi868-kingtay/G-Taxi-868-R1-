-- 20261029150000_cron_secret_cleanup.sql
-- WS3 of the Day-One machine repairs (2026-10-29): remove the literal
-- cron secret from pg_cron command text.
--
-- Trace (live cron.job, 2026-10-29): the readiness audit named TWO jobs
-- (sync-flight-availability-6h, auto-charge-escape-group-5min). A full
-- scan for the current secret value across every cron command found
-- FOURTEEN jobs carrying it as a literal 'x-cron-secret' header value:
--   daily-ai-push (19), sync-flight-availability-6h (28),
--   process-settlement-grace (33), platform_intelligence (37),
--   auto-charge-escape-group-5min (38), process-commander-payout (44),
--   process-expired-codes (45), process-lease-defaults (46),
--   g-dept-ops (48), g-dept-finance (49), g-dept-support (50),
--   g-dept-content_creator (51), g-execute-sweep (52), g-dept-fleet (60).
-- Exactly one occurrence per command (verified by length arithmetic).
-- No database function body contains the value, and no file in this
-- repository contains it (md5 fingerprint scan) — the exposure is
-- confined to these cron rows (visible to anyone who can read cron.job
-- or a cron dump).
--
-- House pattern (already proven live): public.platform_cron_secret()
-- reads the secret from Supabase Vault at call time — see
-- 20260731010000_platform_cron_secret_via_vault.sql. Seven jobs already
-- use it (process-dispatch-queue-1min, process-event-queue,
-- process-pending-wipay-settlements, storage-deletion-drain,
-- zone-capacity-invite-hourly, notify-admins-retry-sends,
-- refresh-flight-pickups-10min) and their calls validate: pg_net
-- responses are 200s and refresh-flight-pickups hits the SAME edge
-- function (sync_flight_availability) as one of the literal jobs.
--
-- Method: for every job whose command still contains the current
-- secret value, rewrite the quoted literal in place via
-- cron.alter_job (direct UPDATE on cron.job is revoked on Supabase;
-- alter_job is the supported path and preserves jobid, schedule,
-- active flag and run history — NULL parameters mean "unchanged" in
-- pg_cron 1.6). Each command becomes byte-identical in shape to the
-- clean jobs: 'x-cron-secret', public.platform_cron_secret().
-- The migration file itself never contains the secret: the value is
-- read from platform_cron_secret() at apply time.
--
-- OPERATIONAL ORDER (important): apply this BEFORE rotating the
-- secret. The rewrite matches on the CURRENT value; if the Vault
-- secret is rotated first, the old literal no longer matches and this
-- migration no-ops while the jobs keep sending the old value. After
-- this migration, rotation is a two-place change (Vault secret +
-- PLATFORM_CRON_SECRET edge-function secret) and every job picks the
-- new value up automatically.
--
-- Smoke-tested in a rolled-back transaction against the live DB
-- before commit; NOT applied live by this branch.

DO $migration$
DECLARE
  r record;
  v_new_command text;
BEGIN
  FOR r IN
    SELECT jobid, command
    FROM cron.job
    WHERE command LIKE '%' || public.platform_cron_secret() || '%'
  LOOP
    v_new_command := replace(
      r.command,
      '''' || public.platform_cron_secret() || '''',
      'public.platform_cron_secret()'
    );
    PERFORM cron.alter_job(job_id := r.jobid, command := v_new_command);
  END LOOP;
END;
$migration$;
