-- ═══════════════════════════════════════════════════════════════════
-- Admin G-Escape Confirm / Delay / Refund buttons work again.
--
-- Before (verified live 2026-10-15): two overloads of admin_escape_action
-- existed, (uuid,text,text,text) and (uuid,text,timestamptz,timestamptz,
-- text,text). The admin page calls it with p_package_id, p_action,
-- p_booking_ref, p_message -- an argument set BOTH accept -- so every
-- click failed with "could not choose the best candidate function".
--
-- After: one version (the 6-argument one, which also records the flight
-- leg when dates/ref are given). Its refund_all now also cancels
-- participants still in payment_pending / intent_pending (the old
-- version did; they have paid nothing, so they are cancelled, not
-- refunded). Admin guard unchanged.
--
-- NOTE: this acts on escape_group_participants (the older Escape system).
-- Live bookings use flight_blocks / package_reservations, managed through
-- the g_proposed_actions approval inbox -- unchanged here.
-- ═══════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.admin_escape_action(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.admin_escape_action(
  p_package_id uuid,
  p_action text,
  p_departure_date timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_arrival_date timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_booking_ref text DEFAULT NULL::text,
  p_message text DEFAULT NULL::text)
RETURNS TABLE(success boolean, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_pkg RECORD;
  v_participant RECORD;
  v_refunded INT := 0;
  v_itinerary_id UUID;
BEGIN
  IF (SELECT role::text FROM public.profiles WHERE profiles.id = auth.uid()) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  SELECT id, package_name INTO v_pkg FROM public.escape_packages WHERE id = p_package_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false::BOOLEAN, 'Package not found'::TEXT;
    RETURN;
  END IF;

  IF p_action = 'confirm' THEN
    FOR v_participant IN
      SELECT p.id, p.rider_id, p.party_size, p.status, p.paid_cents
      FROM public.escape_group_participants p
      WHERE p.package_id = p_package_id AND p.status IN ('confirmed', 'payment_pending')
    LOOP
      IF v_participant.status = 'payment_pending' THEN
        UPDATE public.escape_group_participants
        SET status = 'confirmed', confirmed_at = now()
        WHERE id = v_participant.id;
      END IF;

      INSERT INTO public.passenger_details (participant_id, rider_id, full_name, date_of_birth, nationality)
      VALUES (v_participant.id, v_participant.rider_id, '', '2000-01-01', 'TT')
      ON CONFLICT (participant_id) DO NOTHING;

      UPDATE public.escape_group_participants
      SET status = 'passport_pending'
      WHERE id = v_participant.id;
    END LOOP;

    IF p_booking_ref IS NOT NULL THEN
      SELECT id INTO v_itinerary_id FROM public.master_escape_itineraries WHERE package_id = p_package_id LIMIT 1;
      IF FOUND THEN
        INSERT INTO public.itinerary_legs (master_itinerary_id, leg_sequence, service_type, status, reference_code, scheduled_start, scheduled_end)
        SELECT v_itinerary_id, 1, 'flight', 'confirmed', p_booking_ref, p_departure_date, p_arrival_date
        WHERE EXISTS (SELECT 1 FROM public.escape_group_participants WHERE package_id = p_package_id AND status = 'passport_pending');
      END IF;
    END IF;

    INSERT INTO public.group_booking_alerts (package_id, alert_type, message)
    VALUES (p_package_id, 'reschedule_accepted', 'Admin confirmed package. Ref: ' || COALESCE(p_booking_ref, 'N/A'));

    RETURN QUERY SELECT true::BOOLEAN, 'Confirmed'::TEXT;
    RETURN;
  END IF;

  IF p_action = 'delay' THEN
    INSERT INTO public.group_booking_alerts (package_id, alert_type, message)
    VALUES (p_package_id, 'delay', COALESCE(p_message, 'Trip delayed by admin'));
    RETURN QUERY SELECT true::BOOLEAN, 'Alert logged'::TEXT;
    RETURN;
  END IF;

  IF p_action = 'refund_all' THEN
    FOR v_participant IN
      SELECT p.id, p.rider_id, p.paid_cents
      FROM public.escape_group_participants p
      WHERE p.package_id = p_package_id
        AND p.status IN ('confirmed', 'passport_pending', 'travel_ready', 'payment_pending', 'intent_pending')
    LOOP
      IF COALESCE(v_participant.paid_cents, 0) > 0 THEN
        PERFORM public.credit_wallet(
          v_participant.rider_id,
          v_participant.paid_cents,
          'travel_package_refund',
          'Full refund — trip cancelled by admin',
          v_participant.id::TEXT
        );
        UPDATE public.escape_group_participants SET status = 'refunded' WHERE id = v_participant.id;
      ELSE
        UPDATE public.escape_group_participants SET status = 'cancelled' WHERE id = v_participant.id;
      END IF;
      v_refunded := v_refunded + 1;
    END LOOP;

    INSERT INTO public.group_booking_alerts (package_id, alert_type, message)
    VALUES (p_package_id, 'refund_completed', 'Admin refunded ' || v_refunded || ' participants');

    RETURN QUERY SELECT true::BOOLEAN, 'Refunded ' || v_refunded || ' participants';
    RETURN;
  END IF;

  RETURN QUERY SELECT false::BOOLEAN, 'Unknown action: ' || p_action;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_escape_action(uuid, text, timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_escape_action(uuid, text, timestamptz, timestamptz, text, text) TO authenticated, service_role;
