-- ═══════════════════════════════════════════════════════════════════
-- raise_admin_alert — CAPTURE LIVE STATE INTO A TRACKED MIGRATION
-- (2026-08-01)
--
-- This function was applied to production directly and existed in NO
-- migration file. Rebuilding the schema from supabase/migrations would
-- therefore produce a database where notify_admins_new_garage_request()
-- calls a function that does not exist, and every driver garage request
-- would fail. Caught by diffing live pg_proc against the tracked
-- migrations. This file closes that drift.
--
-- Why this shape (see 20260801020000 for the constraint half):
--   * The DURABLE record is a system_alerts row. It needs no shared
--     secret and no registered device, and the admin dashboard already
--     reads that table. That is the guarantee.
--   * Push is best effort ON TOP, sent straight to Expo. Expo's send
--     API authenticates the DEVICE token, not us, so there is no
--     credential anywhere in this path — which is what removed the
--     Vault secret as a blocker for alerting.
--   * A push failure must never roll back the alert (inner exception
--     block), and an alerting failure must never stop a driver filing a
--     request (the trigger returns NEW regardless).
--
-- Note for whoever reads this next: at time of writing all 4 admin
-- profiles have push_token = NULL, so the push loop is a no-op today.
-- The system_alerts row is the only thing actually reaching a human.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.raise_admin_alert(
    p_type     text,
    p_title    text,
    p_body     text,
    p_severity text DEFAULT 'HIGH',
    p_details  jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_id uuid;
    v_token text;
BEGIN
    INSERT INTO public.system_alerts (type, title, details, severity)
    VALUES (p_type, p_title,
            p_details || jsonb_build_object('body', p_body),
            p_severity)
    RETURNING id INTO v_id;

    BEGIN
        FOR v_token IN
            SELECT push_token FROM public.profiles
             WHERE role = 'admin'
               AND push_token IS NOT NULL
               AND push_token LIKE 'ExponentPushToken%'
        LOOP
            PERFORM net.http_post(
                url     := 'https://exp.host/--/api/v2/push/send',
                headers := jsonb_build_object('Content-Type','application/json'),
                body    := jsonb_build_object(
                    'to', v_token, 'title', p_title, 'body', p_body,
                    'sound', 'default',
                    'data', p_details || jsonb_build_object('alert_id', v_id))
            );
        END LOOP;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.raise_admin_alert(text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.raise_admin_alert(text,text,text,text,jsonb) TO service_role;

COMMENT ON FUNCTION public.raise_admin_alert(text,text,text,text,jsonb) IS
'Single way to reach an admin. Writes a durable system_alerts row (the guarantee — needs no secret, no registered device) then best-effort pushes to any admin Expo token. Never let a push failure lose the alert.';

-- Live body of the garage trigger, which calls the above. The version in
-- 20260731010000 still posts to the notify_admins edge function with a
-- shared secret; this supersedes it.
CREATE OR REPLACE FUNCTION public.notify_admins_new_garage_request()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_driver_name text;
BEGIN
    SELECT name INTO v_driver_name FROM public.drivers WHERE id = NEW.driver_id;
    PERFORM public.raise_admin_alert(
        'GARAGE_REQUEST',
        'G Garage: new vehicle request',
        format('%s requested a %s (%s) — review in G Garage.',
               COALESCE(v_driver_name,'A driver'), NEW.vehicle_class_key, NEW.source),
        'HIGH',
        jsonb_build_object('request_id', NEW.id, 'driver_id', NEW.driver_id)
    );
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- A driver must still be able to file a request even if alerting breaks.
    RETURN NEW;
END;
$$;
