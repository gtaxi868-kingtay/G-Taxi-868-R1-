-- ═══════════════════════════════════════════════════════════════════
-- G Guardian: an SOS must reach a real person (founder, 2026-10-18).
--
-- PROVEN 2026-10-18: an SOS reached nobody. handle_sos pushes to admin
-- phones, but no admin has a push token (the admin app never registered
-- one); the WhatsApp Business app behind sendWhatsApp has been deleted on
-- Meta's side ("Application has been deleted"), so the emergency-contact
-- message never sends; there are no real drivers to warn nearby.
--
-- This adds the human loop, none of it depending on Meta:
--   * guardian_on_call_phone (system_config) — the number the rider's SOS
--     screen calls directly ("Call G Guardian"). Founder choice: the support
--     line 1-868-703-1000. Change it in system_config without a release.
--   * emergency_logs gains acknowledged_at / acknowledged_by / escalations /
--     last_alerted_at.
--   * guardian_open_sos() — admins see every open SOS with names, phones,
--     car and last location.
--   * guardian_acknowledge_sos(id) — "I'm on it": marks it acknowledged and
--     tells the rider (and driver) a G Guardian has the alert.
--   * guardian_resolve_sos(id, false_alarm) — closes it.
--   * my_sos_status(ride) — the rider/driver app polls this to show
--     "A G Guardian has your alert".
--   * escalate_unacknowledged_sos() — every minute: an SOS nobody has
--     acknowledged for 2 minutes is re-raised to every admin as
--     "STILL UNANSWERED", up to 15 times. Launch cutoff: only SOS created
--     after this migration (emergency_logs is empty today; the cutoff is set
--     before the job exists, per house rule).
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO public.system_config (key, value, description, updated_at)
VALUES ('guardian_on_call_phone',
        COALESCE((SELECT value FROM public.system_config WHERE key = 'support_whatsapp_number'), '18687031000'),
        'G Guardian on-call number. The rider and driver SOS screens call this directly. Must be a line a person answers 24/7.',
        now())
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.system_config (key, value, description, updated_at)
VALUES ('guardian_sos_cutoff', now()::text,
        'escalate_unacknowledged_sos only acts on SOS created after this time (set when the G Guardian loop launched).',
        now())
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.emergency_logs
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS escalations integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_alerted_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS emergency_logs_open_idx ON public.emergency_logs (created_at) WHERE status = 'triggered';

DROP POLICY IF EXISTS "Admins read emergency logs" ON public.emergency_logs;
CREATE POLICY "Admins read emergency logs" ON public.emergency_logs
  FOR SELECT TO authenticated USING (public.auth_is_admin());

-- ── Guardian (admin) side ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guardian_open_sos()
 RETURNS TABLE (
   log_id uuid, ride_id uuid, status text, created_at timestamptz,
   acknowledged_at timestamptz, escalations integer, raised_by_role text,
   rider_name text, rider_phone text, emergency_contact_name text, emergency_contact_phone text,
   driver_name text, driver_phone text, vehicle text, plate text,
   lat double precision, lng double precision, pickup_address text, dropoff_address text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT e.id, e.ride_id, e.status, e.created_at, e.acknowledged_at, e.escalations,
         e.metadata->>'raised_by_role',
         p.full_name, p.phone_number, p.emergency_contact_name, p.emergency_contact_phone,
         d.name, d.phone_number, d.vehicle_model, d.plate_number,
         COALESCE(d.lat, r.pickup_lat), COALESCE(d.lng, r.pickup_lng),
         r.pickup_address, r.dropoff_address
    FROM public.emergency_logs e
    LEFT JOIN public.rides r ON r.id = e.ride_id
    LEFT JOIN public.profiles p ON p.id = e.rider_id
    LEFT JOIN public.drivers d ON d.id = e.driver_id
   WHERE public.auth_is_admin()
     AND e.status IN ('triggered', 'acknowledged')
   ORDER BY (e.status = 'triggered') DESC, e.created_at DESC
   LIMIT 50;
$function$;

CREATE OR REPLACE FUNCTION public.guardian_acknowledge_sos(p_log_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_log record;
  v_driver_user uuid;
  v_name text;
BEGIN
  IF NOT public.auth_is_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only a G Guardian (admin) can acknowledge an SOS.');
  END IF;

  SELECT * INTO v_log FROM public.emergency_logs WHERE id = p_log_id FOR UPDATE;
  IF v_log.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SOS not found.');
  END IF;
  IF v_log.status <> 'triggered' THEN
    RETURN jsonb_build_object('success', true, 'status', v_log.status, 'already', true,
                              'acknowledged_at', v_log.acknowledged_at);
  END IF;

  UPDATE public.emergency_logs
     SET status = 'acknowledged', acknowledged_at = now(), acknowledged_by = auth.uid()
   WHERE id = p_log_id;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();

  IF v_log.rider_id IS NOT NULL THEN
    PERFORM public.notify_user(v_log.rider_id, 'ride', 'A G Guardian has your SOS',
      COALESCE(v_name, 'A G Guardian') || ' is on your alert now. If you are in danger, also call 999.');
  END IF;
  SELECT user_id INTO v_driver_user FROM public.drivers WHERE id = v_log.driver_id;
  IF v_driver_user IS NOT NULL THEN
    PERFORM public.notify_user(v_driver_user, 'ride', 'A G Guardian has this SOS',
      'A G Guardian is handling the SOS on your current trip.');
  END IF;

  RETURN jsonb_build_object('success', true, 'status', 'acknowledged');
END;
$function$;

CREATE OR REPLACE FUNCTION public.guardian_resolve_sos(p_log_id uuid, p_false_alarm boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NOT public.auth_is_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only a G Guardian (admin) can close an SOS.');
  END IF;
  UPDATE public.emergency_logs
     SET status = CASE WHEN p_false_alarm THEN 'false_alarm' ELSE 'resolved' END,
         resolved_at = now(),
         acknowledged_at = COALESCE(acknowledged_at, now()),
         acknowledged_by = COALESCE(acknowledged_by, auth.uid())
   WHERE id = p_log_id AND status IN ('triggered', 'acknowledged');
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'SOS not found or already closed.');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ── Rider / driver side ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.my_sos_status(p_ride_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_log record;
BEGIN
  SELECT e.id, e.status, e.acknowledged_at, e.created_at INTO v_log
    FROM public.emergency_logs e
    LEFT JOIN public.drivers d ON d.id = e.driver_id
   WHERE e.ride_id = p_ride_id
     AND (e.rider_id = auth.uid() OR d.user_id = auth.uid())
   ORDER BY e.created_at DESC
   LIMIT 1;
  IF v_log.id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  RETURN jsonb_build_object('found', true, 'log_id', v_log.id, 'status', v_log.status,
                            'acknowledged', v_log.acknowledged_at IS NOT NULL,
                            'acknowledged_at', v_log.acknowledged_at, 'created_at', v_log.created_at,
                            'guardian_phone', (SELECT value FROM public.system_config WHERE key = 'guardian_on_call_phone'));
END;
$function$;

-- ── Nobody answered: keep raising it ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.escalate_unacknowledged_sos()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_cutoff timestamptz := COALESCE((SELECT value FROM public.system_config WHERE key = 'guardian_sos_cutoff')::timestamptz, now());
  v_log record;
  n integer := 0;
BEGIN
  FOR v_log IN
    SELECT e.* FROM public.emergency_logs e
     WHERE e.status = 'triggered'
       AND e.created_at > v_cutoff
       AND e.last_alerted_at < now() - interval '2 minutes'
       AND e.escalations < 15
     ORDER BY e.created_at
     FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.raise_admin_alert(
      'EMERGENCY_SOS',
      format('SOS STILL UNANSWERED (%s min)', GREATEST(1, round(extract(epoch FROM (now() - v_log.created_at)) / 60)::int)),
      format('Nobody has tapped "I''m on it" for the SOS on ride %s. Open the SOS screen and call the rider now.',
             left(COALESCE(v_log.ride_id::text, '?'), 8)),
      'CRITICAL',
      jsonb_build_object('ride_id', v_log.ride_id, 'log_id', v_log.id, 'escalation', v_log.escalations + 1));
    UPDATE public.emergency_logs
       SET escalations = escalations + 1, last_alerted_at = now()
     WHERE id = v_log.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.guardian_open_sos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardian_open_sos() TO authenticated;
REVOKE ALL ON FUNCTION public.guardian_acknowledge_sos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardian_acknowledge_sos(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.guardian_resolve_sos(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardian_resolve_sos(uuid, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.my_sos_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_sos_status(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.escalate_unacknowledged_sos() FROM PUBLIC, anon, authenticated;

DO $cron$
BEGIN
  PERFORM cron.unschedule('escalate-unacknowledged-sos')
   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'escalate-unacknowledged-sos');
  PERFORM cron.schedule('escalate-unacknowledged-sos', '* * * * *', 'SELECT public.escalate_unacknowledged_sos()');
END
$cron$;
