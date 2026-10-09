-- ═══════════════════════════════════════════════════════════════════
-- Nightly purge of pg_cron run history.
--
-- cron.job_run_details was never cleaned. 43 active jobs (5 every
-- minute) write ~10k rows/day; by 2026-10-09 it held ~1.17M rows / 557 MB
-- and the database was running ~300x slower than normal (a 1M-row
-- generate_series took 26s vs 0.19s after cleanup). A one-time delete +
-- VACUUM FULL fixed it; this keeps it from coming back.
--
-- Scope is ONLY pg_cron's own run log. It never touches application
-- data (waitlist, users, rides, money). 7 days of history is kept for
-- debugging failed jobs.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.purge_cron_history()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_deleted integer;
BEGIN
    DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$function$;
REVOKE ALL ON FUNCTION public.purge_cron_history() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-cron-history') THEN
        PERFORM cron.unschedule('purge-cron-history');
    END IF;
END $$;

SELECT cron.schedule('purge-cron-history', '30 3 * * *', $job$SELECT public.purge_cron_history()$job$);
