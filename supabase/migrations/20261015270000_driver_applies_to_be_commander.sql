-- ═══════════════════════════════════════════════════════════════════
-- Driver app "Become a Commander" can actually submit an application.
--
-- Before (verified live 2026-10-15): the screen read drivers.rides_count
-- (no such column, so it always errored) and inserted straight into
-- commander_applications with full_name/reasoning columns that do not exist
-- and no INSERT policy. The intended server flow, commander_apply (creates
-- the application + WiPay TT$500 buy-in checkout), was never deployed and
-- the project is at the 100-edge-function cap.
--
-- After: apply_to_be_commander(phone, area) records the application
-- server-side, checking the same prerequisites the screen shows (500
-- finished rides, 4.8+ rating) from real data, so the app cannot skip them.
-- driver_commander_stats() gives the screen those real numbers.
--
-- Unchanged on purpose: admin approve_application still requires the
-- buy-in to be paid (payment_status = 'paid'). Taking that payment needs
-- WiPay keys and a function slot for commander_apply: owner decision.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.driver_commander_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT jsonb_build_object(
    'rides_count', (SELECT count(*) FROM public.rides r
                     WHERE r.driver_id = d.id
                       AND r.status IN ('completed', 'payment_confirmed', 'closed')),
    'rating', COALESCE(d.rating, 0),
    'phone', d.phone_number,
    'application_status', (SELECT a.status FROM public.commander_applications a
                            WHERE a.user_id = auth.uid()
                            ORDER BY a.created_at DESC LIMIT 1)
  )
  FROM public.drivers d
  WHERE d.user_id = auth.uid();
$function$;

REVOKE ALL ON FUNCTION public.driver_commander_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_commander_stats() TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_to_be_commander(p_phone text, p_area text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_driver record;
  v_rides integer;
  v_app_id uuid;
BEGIN
  SELECT id, rating INTO v_driver FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only drivers can apply.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.pod_commanders WHERE user_id = auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are already a commander.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.commander_applications WHERE user_id = auth.uid() AND status = 'pending') THEN
    RETURN jsonb_build_object('success', false, 'error', 'You already have an application under review.');
  END IF;

  SELECT count(*) INTO v_rides FROM public.rides
   WHERE driver_id = v_driver.id AND status IN ('completed', 'payment_confirmed', 'closed');
  IF v_rides < 500 OR COALESCE(v_driver.rating, 0) < 4.8 THEN
    RETURN jsonb_build_object('success', false, 'error', 'You need 500 finished rides and a 4.8+ rating to apply.');
  END IF;

  IF char_length(btrim(COALESCE(p_phone, ''))) < 7 OR char_length(btrim(COALESCE(p_area, ''))) < 2 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please enter your phone number and area.');
  END IF;

  INSERT INTO public.commander_applications (user_id, phone, whatsapp, area)
  VALUES (auth.uid(), btrim(p_phone), btrim(p_phone), left(btrim(p_area), 100))
  RETURNING id INTO v_app_id;

  RETURN jsonb_build_object('success', true, 'application_id', v_app_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_to_be_commander(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_to_be_commander(text, text) TO authenticated;
