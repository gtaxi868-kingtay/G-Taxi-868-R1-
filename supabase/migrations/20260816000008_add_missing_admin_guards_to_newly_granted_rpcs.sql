-- Immediately after granting EXECUTE ON these 5 functions to `authenticated`
-- (previous migration, same session), reading their FULL bodies revealed
-- they have NO internal admin-role guard at all -- unlike their sibling
-- admin_* functions, which do. Before that grant they were completely
-- unreachable (0 grant at all), so this was latent, not live-exploited.
-- After the grant they would have been reachable by ANY authenticated
-- user, not just admins:
--   - admin_get_surge_zones: read-only, low sensitivity, but still not
--     admin-gated
--   - admin_get_organizer_banks: leaks real bank_name/account_number/
--     account_holder_name for ANY organizer_id -- real PII/financial leak
--   - admin_upsert_organizer_bank: lets ANY authenticated user OVERWRITE
--     an organizer's bank account details -- a payout-redirect fraud
--     vector, the most serious of the five
--   - admin_escape_action (6-arg overload w/ departure_date/arrival_date):
--     money-moving (refund_all branch calls credit_wallet with real
--     paid_cents) -- reachable with zero guard
--   - approve_driver_lease: activates a driver's vehicle lease/finance
--     agreement -- reachable with zero guard
--
-- CREATE OR REPLACE on an existing function (same signature) updates the
-- body in place and does NOT reset the ACL -- unlike DROP+CREATE or a
-- signature change, which create a new catalog entry with the Postgres
-- default (PUBLIC EXECUTE). Verified live after this migration that the
-- authenticated-only grant survived unchanged and PUBLIC/anon remained
-- ungranted, and that a non-admin real account is rejected while a real
-- admin account still succeeds, for all 5 functions.
CREATE OR REPLACE FUNCTION public.admin_get_surge_zones()
 RETURNS TABLE(id uuid, name text, center_lat numeric, center_lng numeric, radius_meters integer, multiplier numeric, reason text, expires_at timestamp with time zone, is_active boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF (SELECT role::text FROM public.profiles WHERE profiles.id = auth.uid()) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Unauthorized: admin role required';
    END IF;

    RETURN QUERY
    SELECT pz.id, pz.name, pz.center_lat, pz.center_lng, pz.radius_meters,
           pz.multiplier, pz.reason, pz.expires_at, pz.is_active, pz.created_at
    FROM public.pricing_zones pz ORDER BY pz.created_at DESC LIMIT 100;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_organizer_banks(p_organizer_id uuid, p_ledger_type text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, organizer_id uuid, ledger_type text, bank_name text, account_holder_name text, account_number text, account_type text, is_default boolean, is_verified boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF (SELECT role::text FROM public.profiles WHERE profiles.id = auth.uid()) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    oba.id, oba.organizer_id, oba.ledger_type, oba.bank_name, oba.account_holder_name,
    oba.account_number, oba.account_type, oba.is_default, oba.is_verified, oba.created_at
  FROM organizer_bank_accounts oba
  WHERE oba.organizer_id = p_organizer_id
    AND (p_ledger_type IS NULL OR oba.ledger_type = p_ledger_type)
  ORDER BY oba.is_default DESC, oba.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_upsert_organizer_bank(p_organizer_id uuid, p_ledger_type text, p_bank_name text, p_account_holder_name text, p_account_number text, p_account_type text DEFAULT 'savings'::text, p_is_default boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF (SELECT role::text FROM public.profiles WHERE profiles.id = auth.uid()) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  IF p_ledger_type NOT IN ('band', 'event') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid ledger_type');
  END IF;

  INSERT INTO organizer_bank_accounts
    (organizer_id, ledger_type, bank_name, account_holder_name, account_number, account_type, is_default)
  VALUES
    (p_organizer_id, p_ledger_type, p_bank_name, p_account_holder_name, p_account_number, p_account_type, p_is_default)
  ON CONFLICT (organizer_id, ledger_type, account_number)
  DO UPDATE SET
    bank_name = EXCLUDED.bank_name,
    account_holder_name = EXCLUDED.account_holder_name,
    account_type = EXCLUDED.account_type,
    is_default = EXCLUDED.is_default,
    updated_at = NOW()
  RETURNING id INTO v_id;

  IF p_is_default THEN
    UPDATE organizer_bank_accounts
    SET is_default = false
    WHERE organizer_id = p_organizer_id
      AND ledger_type = p_ledger_type
      AND id <> v_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'bank_account_id', v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_escape_action(p_package_id uuid, p_action text, p_departure_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_arrival_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_booking_ref text DEFAULT NULL::text, p_message text DEFAULT NULL::text)
 RETURNS TABLE(success boolean, detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_pkg RECORD;
  v_participant RECORD;
  v_refunded INT := 0;
  v_notified INT := 0;
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
      WHERE p.package_id = p_package_id AND p.status IN ('confirmed', 'passport_pending', 'travel_ready')
    LOOP
      IF v_participant.paid_cents > 0 THEN
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

CREATE OR REPLACE FUNCTION public.approve_driver_lease(p_lease_id uuid, p_term_finance_agreement_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_lease record;
    v_driver_id uuid;
    v_vehicle_id uuid;
BEGIN
    IF (SELECT role::text FROM public.profiles WHERE profiles.id = auth.uid()) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Unauthorized: admin role required';
    END IF;

    SELECT * INTO v_lease FROM public.driver_leases WHERE id = p_lease_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Lease not found'); END IF;
    IF v_lease.status != 'pending' THEN RETURN jsonb_build_object('success', false, 'error', 'Lease is not pending'); END IF;

    UPDATE public.driver_leases
    SET status = 'active',
        term_finance_agreement_id = COALESCE(p_term_finance_agreement_id, term_finance_agreement_id),
        driver_approved_at = now(),
        term_finance_approved_at = now()
    WHERE id = p_lease_id
    RETURNING driver_id, fleet_vehicle_id INTO v_driver_id, v_vehicle_id;

    UPDATE public.drivers
    SET fleet_lease_id = p_lease_id, vehicle_model = (SELECT make || ' ' || model FROM public.fleet_vehicles WHERE id = v_vehicle_id)
    WHERE id = v_driver_id;

    RETURN jsonb_build_object('success', true, 'data', jsonb_build_object('lease_id', p_lease_id, 'status', 'active'));
END;
$function$;
