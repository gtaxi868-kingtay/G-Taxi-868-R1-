-- ═══════════════════════════════════════════════════════════════════════════
-- WATCHDOG — a failing background job must reach a human, not just bill you
-- (2026-08-07)
--
-- Two scheduled jobs returned 500 on every run: 430 failed invocations in six
-- hours, every one paid for, none doing the work they existed to do. Nothing
-- noticed. pg_cron logged them as "succeeded" because the SQL ran — pg_net is
-- asynchronous, so the HTTP failure lands later in net._http_response, and
-- nothing in this system was ever reading that table.
--
-- This reads it. Anything not 2xx becomes ONE admin alert per distinct
-- problem, which reaches all three places at once through the single
-- raise_admin_alert path:
--   * admin web    — system_alerts is what the dashboard renders
--   * admin mobile — pushes to any registered admin device
--   * G            — g_agent_runner's get_open_alerts reads unresolved
--                    system_alerts, so "what's up" answers factually
--
-- ANTI-STORM, which matters more here than the alerting:
--   * one alert per distinct (status, message) fingerprint while unresolved —
--     359 identical failures raise ONE row, not 359
--   * a threshold, so a single blip is not an incident
--   * a lookback window, so resolving an alert does not instantly re-raise it
--     from the same historical rows
--   A prematurely-firing sweep once created 101 bogus alerts in this database
--   that had to be cleaned up by hand. Not again.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.g_config (key, value)
VALUES ('edge_watchdog', jsonb_build_object(
          'enabled', true, 'window_minutes', 30, 'min_failures', 3))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sweep_edge_failures()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_cfg jsonb; v_window integer; v_min integer;
    v_raised integer := 0; v_finger text; rec record;
BEGIN
    v_cfg := (SELECT value FROM public.g_config WHERE key = 'edge_watchdog');
    IF NOT COALESCE((v_cfg->>'enabled')::boolean, true) THEN RETURN 0; END IF;
    v_window := COALESCE((v_cfg->>'window_minutes')::integer, 30);
    v_min    := COALESCE((v_cfg->>'min_failures')::integer, 3);

    FOR rec IN
        SELECT COALESCE(status_code, 0) AS code,
               left(COALESCE(content, 'no response body'), 200) AS body,
               count(*) AS failures, max(created) AS latest
          FROM net._http_response
         WHERE created > now() - ((v_window::text || ' minutes')::interval)
           AND (status_code IS NULL OR status_code < 200 OR status_code >= 300)
         GROUP BY 1, 2
        HAVING count(*) >= v_min
    LOOP
        v_finger := md5(rec.code::text || rec.body);

        IF EXISTS (SELECT 1 FROM public.system_alerts
                    WHERE type = 'WATCHDOG_ANOMALY' AND resolved_at IS NULL
                      AND details->>'fingerprint' = v_finger) THEN
            CONTINUE;
        END IF;

        PERFORM public.raise_admin_alert(
            'WATCHDOG_ANOMALY',
            'A background job is failing',
            format('%s failed background calls in the last %s minutes, all returning %s. Response: %s',
                   rec.failures, v_window, rec.code, rec.body),
            CASE WHEN rec.failures >= 50 THEN 'CRITICAL' ELSE 'HIGH' END,
            jsonb_build_object('fingerprint', v_finger, 'status_code', rec.code,
                               'failures', rec.failures, 'window_min', v_window,
                               'last_seen', rec.latest, 'response', rec.body));
        v_raised := v_raised + 1;
    END LOOP;

    RETURN v_raised;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_edge_failures() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_edge_failures() TO service_role;

COMMENT ON FUNCTION public.sweep_edge_failures() IS
'Turns non-2xx background HTTP responses into ONE admin alert per distinct problem. Reaches admin web (system_alerts), admin mobile (push) and G (get_open_alerts) through the single raise_admin_alert path.';

SELECT cron.unschedule('edge-failure-watchdog')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'edge-failure-watchdog');

SELECT cron.schedule('edge-failure-watchdog', '*/15 * * * *',
                     $cron$SELECT public.sweep_edge_failures();$cron$);
