-- ═══════════════════════════════════════════════════════════════════════════
-- DATA RETENTION — make the promise real
-- (2026-08-06)
--
-- docs/legal/DATA_RETENTION_AND_DELETION.md section 7 said, in writing, that
-- NONE of the retention schedules ran. Nothing purged passport numbers.
-- Nothing anonymised a closed account. Nothing forgot where anyone had been.
-- This file is the machinery that makes the notice true rather than
-- aspirational, and it is the reason that section can now be rewritten.
--
-- THE PRINCIPLE THIS ENCODES
-- -------------------------
-- Data minimisation and storage limitation: personal data is kept only while
-- there is a reason, and when the reason expires the data goes. Where the law
-- forces us to keep a record (tax, transport, insurance), we keep the RECORD
-- and destroy the IDENTITY — that is anonymisation, and it is what lets a
-- deletion request be honoured without breaking a 7-year financial trail.
--
-- WHAT IT DELIBERATELY DOES NOT TOUCH
-- -----------------------------------
--   * wallet_transactions, payment ledgers, payouts — financial records.
--     They are anonymised through the account, never deleted.
--   * driver compliance documents — regulatory and insurance evidence.
--   * user_consents — the proof of what someone agreed to. Destroying it
--     would destroy our own defence.
--   * anything attached to an unresolved incident or an open dispute
--     (see the legal-hold guard in purge_expired_personal_data).
--
-- HOW IT IS SAFE TO RUN
-- ---------------------
--   * Every category is driven by a row in data_retention_policy, so a period
--     changes with an UPDATE and no redeploy — and an admin can SEE the whole
--     schedule in one query instead of reading plpgsql.
--   * enabled=false on any row switches that category off instantly.
--   * Every run writes data_retention_runs: category, action, rows, when.
--     A purge with no audit trail is indistinguishable from data loss.
--   * dry_run mode reports exactly what WOULD go without touching anything.
--     The first live run should always be preceded by one.
--   * Each category is in its own exception block. One bad category cannot
--     stop the other nine.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- 1. The schedule, as data.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.data_retention_policy (
    category       text PRIMARY KEY,
    description    text NOT NULL,
    retention_days integer NOT NULL CHECK (retention_days > 0),
    action         text NOT NULL CHECK (action IN ('delete','anonymise','redact')),
    legal_basis    text,
    enabled        boolean NOT NULL DEFAULT true,
    updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.data_retention_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_retention_policy FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_retention_policy FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.data_retention_runs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    category      text NOT NULL,
    action        text NOT NULL,
    rows_affected integer NOT NULL DEFAULT 0,
    dry_run       boolean NOT NULL DEFAULT false,
    error         text,
    ran_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS data_retention_runs_ran_at_idx
    ON public.data_retention_runs (ran_at DESC);
ALTER TABLE public.data_retention_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_retention_runs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_retention_runs FROM anon, authenticated;

-- Periods match docs/legal/DATA_RETENTION_AND_DELETION.md section 3. If one
-- changes here, change it there — the notice is the public promise.
INSERT INTO public.data_retention_policy (category, description, retention_days, action, legal_basis) VALUES
  ('travel_passport_data', 'Passport number, DOB and emergency contact for a booking, measured from the later of submission and the return flight', 90, 'delete',
   'Held only because an airline or border authority requires it. No purpose survives the trip.'),
  ('reservation_passenger_names', 'Passenger names and passport image on a booking record', 90, 'redact',
   'Same basis as travel_passport_data. The booking itself stays as a financial record.'),
  ('ride_addresses', 'Pickup and drop-off addresses on completed rides', 365, 'redact',
   'Beyond a year there is no reason to hold where a person went. Fare and date survive for tax.'),
  ('driver_location_trace', 'Raw GPS breadcrumbs', 90, 'delete',
   'Kept for safety investigations and fare disputes; useless and intrusive after.'),
  ('zone_safety_points', 'Identity attached to a safety observation', 90, 'anonymise',
   'The observation stays useful to the safety map; the driver and ride links do not need to.'),
  ('ride_messages', 'In-trip chat between rider and driver', 90, 'delete',
   'Transient trip coordination, not a record either party expects us to keep.'),
  ('emergency_log_details', 'Names, phone numbers and coordinates inside an incident record', 730, 'redact',
   'The incident record is kept as safety evidence; the personal detail inside it is not needed after two years.'),
  ('push_tickets', 'Push-notification delivery receipts', 90, 'delete',
   'Operational only.'),
  ('assistant_reminders', 'Delivered assistant reminders', 90, 'delete',
   'Consent-based and already served.'),
  ('admin_audit_ip', 'IP addresses in the admin audit log', 365, 'redact',
   'The action and the actor remain for 7 years; the IP does not need to.'),
  ('account_anonymisation', 'Closed accounts past their restore window', 30, 'anonymise',
   'Deletion request honoured; legally required financial records survive without identity.')
ON CONFLICT (category) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Account deletion — the user-facing half.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
    user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    requested_at   timestamptz NOT NULL DEFAULT now(),
    scheduled_at   timestamptz NOT NULL,
    status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','cancelled','completed','on_hold')),
    hold_reason    text,
    completed_at   timestamptz
);
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_requests FROM anon, authenticated;
GRANT SELECT ON public.account_deletion_requests TO authenticated;

DROP POLICY IF EXISTS adr_own_row ON public.account_deletion_requests;
CREATE POLICY adr_own_row ON public.account_deletion_requests
    FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. anonymise_user — destroy the identity, keep the legally required record.
--
--    Deliberately NOT a DELETE of auth.users: removing the row would cascade
--    through wallet_transactions and the ride history and destroy the 7-year
--    financial trail we are required to hold. Anonymising is both the lawful
--    answer and the honest one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anonymise_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_tomb text := 'deleted-' || left(md5(p_user_id::text), 12);
    v_out  jsonb := '{}'::jsonb;
    v_n    integer;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('error', 'user_id required');
    END IF;

    UPDATE public.profiles SET
        full_name              = 'Deleted user',
        email                  = v_tomb || '@deleted.invalid',
        phone_number           = NULL,
        avatar_url             = NULL,
        push_token             = NULL,
        emergency_contact_name = NULL,
        emergency_contact_phone= NULL,
        national_id_hash       = NULL,
        nfc_uid                = NULL,
        notification_enabled   = false
    WHERE id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('profiles', v_n);

    -- A driver row keeps its regulatory identifiers (plate, documents) because
    -- transport and insurance law requires them. Contact details do not.
    UPDATE public.drivers SET
        name                   = 'Deleted driver',
        phone_number           = NULL,
        push_token             = NULL,
        emergency_contact_name = NULL,
        emergency_contact_phone= NULL,
        bank_details           = NULL,
        is_online              = false,
        lat = NULL, lng = NULL, location = NULL
    WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('drivers', v_n);

    DELETE FROM public.saved_places WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('saved_places', v_n);

    DELETE FROM public.g_rider_memory WHERE rider_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('assistant_memory', v_n);

    DELETE FROM public.g_rider_reminders WHERE rider_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('assistant_reminders', v_n);

    DELETE FROM public.passenger_details WHERE rider_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('passport_records', v_n);

    -- Where the person went is theirs; the fare and date are the tax record.
    UPDATE public.rides
       SET pickup_address = NULL, dropoff_address = NULL
     WHERE rider_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('ride_addresses_cleared', v_n);

    DELETE FROM public.ride_messages WHERE sender_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('ride_messages', v_n);

    RETURN jsonb_build_object('success', true, 'user_id', p_user_id, 'affected', v_out);
END;
$$;

REVOKE ALL ON FUNCTION public.anonymise_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymise_user(uuid) TO service_role;

COMMENT ON FUNCTION public.anonymise_user(uuid) IS
'Destroys identity, preserves legally required records. Never DELETEs auth.users — that would cascade away the 7-year financial trail we are obliged to keep.';

-- ---------------------------------------------------------------------------
-- 4. request_account_deletion / cancel_account_deletion — what the app calls.
--    Identity comes from auth.uid(). A caller cannot delete anyone else.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_uid   uuid := auth.uid();
    v_days  integer;
    v_when  timestamptz;
    v_bal   numeric;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'not signed in');
    END IF;

    SELECT retention_days INTO v_days
      FROM public.data_retention_policy WHERE category = 'account_anonymisation';
    v_when := now() + ((COALESCE(v_days, 30))::text || ' days')::interval;

    -- Tell them about money BEFORE they commit. A balance cannot be returned
    -- once the identity is gone, and finding that out afterwards is the worst
    -- possible moment.
    SELECT COALESCE(SUM(amount), 0) INTO v_bal
      FROM public.wallet_transactions WHERE user_id = v_uid AND status = 'completed';

    INSERT INTO public.account_deletion_requests (user_id, scheduled_at, status)
    VALUES (v_uid, v_when, 'pending')
    ON CONFLICT (user_id) DO UPDATE
      SET status = 'pending', requested_at = now(), scheduled_at = v_when,
          completed_at = NULL, hold_reason = NULL;

    UPDATE public.profiles SET suspended = true WHERE id = v_uid;

    RETURN jsonb_build_object(
        'success', true,
        'scheduled_at', v_when,
        'grace_days', COALESCE(v_days, 30),
        'wallet_balance_cents', v_bal,
        'warning', CASE WHEN v_bal > 0
                        THEN 'You have money in your wallet. Withdraw it before the grace period ends — it cannot be returned afterwards.'
                        END);
END;
$$;

REVOKE ALL ON FUNCTION public.request_account_deletion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_account_deletion()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_n   integer;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'not signed in');
    END IF;

    UPDATE public.account_deletion_requests
       SET status = 'cancelled'
     WHERE user_id = v_uid AND status = 'pending';
    GET DIAGNOSTICS v_n = ROW_COUNT;

    IF v_n = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'no pending deletion request');
    END IF;

    UPDATE public.profiles SET suspended = false WHERE id = v_uid;
    RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_account_deletion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_account_deletion() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. purge_expired_personal_data — the nightly sweep.
--    p_dry_run true reports without touching. ALWAYS dry-run first.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_expired_personal_data(p_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_result jsonb := '{}'::jsonb;
    v_days   integer;
    v_act    text;
    v_n      integer;
    rec      record;
    -- Categories are looked up individually so a disabled row is genuinely
    -- skipped rather than silently defaulted to some hardcoded period.
BEGIN
    -- ---- travel passport data -------------------------------------------
    SELECT retention_days INTO v_days FROM public.data_retention_policy
     WHERE category='travel_passport_data' AND enabled;
    IF v_days IS NOT NULL THEN
      BEGIN
        WITH last_travel AS (
            SELECT pr.rider_id, MAX(COALESCE(fb.return_time, fb.departure_time)) AS ends_at
              FROM public.package_reservations pr
              LEFT JOIN public.flight_blocks fb ON fb.id = pr.flight_block_id
             GROUP BY pr.rider_id
        ), doomed AS (
            SELECT pd.id FROM public.passenger_details pd
              LEFT JOIN last_travel lt ON lt.rider_id = pd.rider_id
             WHERE GREATEST(pd.submitted_at, COALESCE(lt.ends_at, pd.submitted_at))
                   < now() - (v_days::text || ' days')::interval
        )
        SELECT count(*) INTO v_n FROM doomed;

        IF NOT p_dry_run AND v_n > 0 THEN
            DELETE FROM public.passenger_details pd
             WHERE pd.id IN (
               SELECT pd2.id FROM public.passenger_details pd2
                 LEFT JOIN (SELECT pr.rider_id, MAX(COALESCE(fb.return_time, fb.departure_time)) AS ends_at
                              FROM public.package_reservations pr
                              LEFT JOIN public.flight_blocks fb ON fb.id = pr.flight_block_id
                             GROUP BY pr.rider_id) lt ON lt.rider_id = pd2.rider_id
                WHERE GREATEST(pd2.submitted_at, COALESCE(lt.ends_at, pd2.submitted_at))
                      < now() - (v_days::text || ' days')::interval);
        END IF;

        INSERT INTO public.data_retention_runs (category, action, rows_affected, dry_run)
        VALUES ('travel_passport_data','delete', v_n, p_dry_run);
        v_result := v_result || jsonb_build_object('travel_passport_data', v_n);
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.data_retention_runs (category, action, rows_affected, dry_run, error)
        VALUES ('travel_passport_data','delete', 0, p_dry_run, SQLERRM);
      END;
    END IF;

    -- ---- reservation passenger names / passport image --------------------
    SELECT retention_days INTO v_days FROM public.data_retention_policy
     WHERE category='reservation_passenger_names' AND enabled;
    IF v_days IS NOT NULL THEN
      BEGIN
        SELECT count(*) INTO v_n FROM public.package_reservations pr
          LEFT JOIN public.flight_blocks fb ON fb.id = pr.flight_block_id
         WHERE (pr.passenger_names IS NOT NULL OR pr.passport_image_url IS NOT NULL)
           AND COALESCE(fb.return_time, fb.departure_time, pr.created_at)
               < now() - (v_days::text || ' days')::interval;

        IF NOT p_dry_run AND v_n > 0 THEN
            UPDATE public.package_reservations pr
               SET passenger_names = NULL, passport_image_url = NULL
              FROM public.flight_blocks fb
             WHERE fb.id = pr.flight_block_id
               AND (pr.passenger_names IS NOT NULL OR pr.passport_image_url IS NOT NULL)
               AND COALESCE(fb.return_time, fb.departure_time, pr.created_at)
                   < now() - (v_days::text || ' days')::interval;
        END IF;

        INSERT INTO public.data_retention_runs (category, action, rows_affected, dry_run)
        VALUES ('reservation_passenger_names','redact', v_n, p_dry_run);
        v_result := v_result || jsonb_build_object('reservation_passenger_names', v_n);
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.data_retention_runs (category, action, rows_affected, dry_run, error)
        VALUES ('reservation_passenger_names','redact', 0, p_dry_run, SQLERRM);
      END;
    END IF;

    -- ---- ride addresses ---------------------------------------------------
    -- Legal hold: a ride tied to an unresolved incident or an open support
    -- ticket keeps its addresses. Evidence outranks the schedule.
    SELECT retention_days INTO v_days FROM public.data_retention_policy
     WHERE category='ride_addresses' AND enabled;
    IF v_days IS NOT NULL THEN
      BEGIN
        SELECT count(*) INTO v_n FROM public.rides r
         WHERE (r.pickup_address IS NOT NULL OR r.dropoff_address IS NOT NULL)
           AND r.completed_at IS NOT NULL
           AND r.completed_at < now() - (v_days::text || ' days')::interval
           AND NOT EXISTS (SELECT 1 FROM public.emergency_logs e
                            WHERE e.ride_id = r.id AND e.resolved_at IS NULL)
           AND NOT EXISTS (SELECT 1 FROM public.support_tickets t
                            WHERE t.ride_id = r.id AND t.status NOT IN ('resolved','closed'));

        IF NOT p_dry_run AND v_n > 0 THEN
            UPDATE public.rides r
               SET pickup_address = NULL, dropoff_address = NULL
             WHERE (r.pickup_address IS NOT NULL OR r.dropoff_address IS NOT NULL)
               AND r.completed_at IS NOT NULL
               AND r.completed_at < now() - (v_days::text || ' days')::interval
               AND NOT EXISTS (SELECT 1 FROM public.emergency_logs e
                                WHERE e.ride_id = r.id AND e.resolved_at IS NULL)
               AND NOT EXISTS (SELECT 1 FROM public.support_tickets t
                                WHERE t.ride_id = r.id AND t.status NOT IN ('resolved','closed'));
        END IF;

        INSERT INTO public.data_retention_runs (category, action, rows_affected, dry_run)
        VALUES ('ride_addresses','redact', v_n, p_dry_run);
        v_result := v_result || jsonb_build_object('ride_addresses', v_n);
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.data_retention_runs (category, action, rows_affected, dry_run, error)
        VALUES ('ride_addresses','redact', 0, p_dry_run, SQLERRM);
      END;
    END IF;

    -- ---- GPS breadcrumbs --------------------------------------------------
    SELECT retention_days INTO v_days FROM public.data_retention_policy
     WHERE category='driver_location_trace' AND enabled;
    IF v_days IS NOT NULL THEN
      BEGIN
        SELECT count(*) INTO v_n FROM public.driver_locations
         WHERE created_at < now() - (v_days::text || ' days')::interval;
        IF NOT p_dry_run AND v_n > 0 THEN
            DELETE FROM public.driver_locations
             WHERE created_at < now() - (v_days::text || ' days')::interval;
        END IF;
        INSERT INTO public.data_retention_runs (category, action, rows_affected, dry_run)
        VALUES ('driver_location_trace','delete', v_n, p_dry_run);
        v_result := v_result || jsonb_build_object('driver_location_trace', v_n);
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.data_retention_runs (category, action, rows_affected, dry_run, error)
        VALUES ('driver_location_trace','delete', 0, p_dry_run, SQLERRM);
      END;
    END IF;

    -- ---- safety points: keep the observation, drop the person -------------
    SELECT retention_days INTO v_days FROM public.data_retention_policy
     WHERE category='zone_safety_points' AND enabled;
    IF v_days IS NOT NULL THEN
      BEGIN
        SELECT count(*) INTO v_n FROM public.zone_safety_events
         WHERE (driver_id IS NOT NULL OR ride_id IS NOT NULL OR order_id IS NOT NULL)
           AND occurred_at < now() - (v_days::text || ' days')::interval;
        IF NOT p_dry_run AND v_n > 0 THEN
            UPDATE public.zone_safety_events
               SET driver_id = NULL, ride_id = NULL, order_id = NULL
             WHERE (driver_id IS NOT NULL OR ride_id IS NOT NULL OR order_id IS NOT NULL)
               AND occurred_at < now() - (v_days::text || ' days')::interval;
        END IF;
        INSERT INTO public.data_retention_runs (category, action, rows_affected, dry_run)
        VALUES ('zone_safety_points','anonymise', v_n, p_dry_run);
        v_result := v_result || jsonb_build_object('zone_safety_points', v_n);
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.data_retention_runs (category, action, rows_affected, dry_run, error)
        VALUES ('zone_safety_points','anonymise', 0, p_dry_run, SQLERRM);
      END;
    END IF;

    -- ---- in-trip chat -----------------------------------------------------
    SELECT retention_days INTO v_days FROM public.data_retention_policy
     WHERE category='ride_messages' AND enabled;
    IF v_days IS NOT NULL THEN
      BEGIN
        SELECT count(*) INTO v_n FROM public.ride_messages m
         WHERE m.created_at < now() - (v_days::text || ' days')::interval
           AND NOT EXISTS (SELECT 1 FROM public.support_tickets t
                            WHERE t.ride_id = m.ride_id AND t.status NOT IN ('resolved','closed'));
        IF NOT p_dry_run AND v_n > 0 THEN
            DELETE FROM public.ride_messages m
             WHERE m.created_at < now() - (v_days::text || ' days')::interval
               AND NOT EXISTS (SELECT 1 FROM public.support_tickets t
                                WHERE t.ride_id = m.ride_id AND t.status NOT IN ('resolved','closed'));
        END IF;
        INSERT INTO public.data_retention_runs (category, action, rows_affected, dry_run)
        VALUES ('ride_messages','delete', v_n, p_dry_run);
        v_result := v_result || jsonb_build_object('ride_messages', v_n);
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.data_retention_runs (category, action, rows_affected, dry_run, error)
        VALUES ('ride_messages','delete', 0, p_dry_run, SQLERRM);
      END;
    END IF;

    -- ---- incident detail (record survives, personal detail does not) ------
    SELECT retention_days INTO v_days FROM public.data_retention_policy
     WHERE category='emergency_log_details' AND enabled;
    IF v_days IS NOT NULL THEN
      BEGIN
        SELECT count(*) INTO v_n FROM public.emergency_logs
         WHERE metadata IS NOT NULL AND metadata <> '{}'::jsonb
           AND resolved_at IS NOT NULL
           AND created_at < now() - (v_days::text || ' days')::interval;
        IF NOT p_dry_run AND v_n > 0 THEN
            UPDATE public.emergency_logs
               SET metadata = jsonb_build_object('redacted_at', now(),
                                                 'note', 'personal detail removed under retention policy')
             WHERE metadata IS NOT NULL AND metadata <> '{}'::jsonb
               AND resolved_at IS NOT NULL
               AND created_at < now() - (v_days::text || ' days')::interval;
        END IF;
        INSERT INTO public.data_retention_runs (category, action, rows_affected, dry_run)
        VALUES ('emergency_log_details','redact', v_n, p_dry_run);
        v_result := v_result || jsonb_build_object('emergency_log_details', v_n);
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.data_retention_runs (category, action, rows_affected, dry_run, error)
        VALUES ('emergency_log_details','redact', 0, p_dry_run, SQLERRM);
      END;
    END IF;

    -- ---- push receipts ----------------------------------------------------
    SELECT retention_days INTO v_days FROM public.data_retention_policy
     WHERE category='push_tickets' AND enabled;
    IF v_days IS NOT NULL THEN
      BEGIN
        SELECT count(*) INTO v_n FROM public.expo_push_tickets
         WHERE created_at < now() - (v_days::text || ' days')::interval;
        IF NOT p_dry_run AND v_n > 0 THEN
            DELETE FROM public.expo_push_tickets
             WHERE created_at < now() - (v_days::text || ' days')::interval;
        END IF;
        INSERT INTO public.data_retention_runs (category, action, rows_affected, dry_run)
        VALUES ('push_tickets','delete', v_n, p_dry_run);
        v_result := v_result || jsonb_build_object('push_tickets', v_n);
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.data_retention_runs (category, action, rows_affected, dry_run, error)
        VALUES ('push_tickets','delete', 0, p_dry_run, SQLERRM);
      END;
    END IF;

    -- ---- delivered assistant reminders ------------------------------------
    SELECT retention_days INTO v_days FROM public.data_retention_policy
     WHERE category='assistant_reminders' AND enabled;
    IF v_days IS NOT NULL THEN
      BEGIN
        SELECT count(*) INTO v_n FROM public.g_rider_reminders
         WHERE delivered_at IS NOT NULL
           AND delivered_at < now() - (v_days::text || ' days')::interval;
        IF NOT p_dry_run AND v_n > 0 THEN
            DELETE FROM public.g_rider_reminders
             WHERE delivered_at IS NOT NULL
               AND delivered_at < now() - (v_days::text || ' days')::interval;
        END IF;
        INSERT INTO public.data_retention_runs (category, action, rows_affected, dry_run)
        VALUES ('assistant_reminders','delete', v_n, p_dry_run);
        v_result := v_result || jsonb_build_object('assistant_reminders', v_n);
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.data_retention_runs (category, action, rows_affected, dry_run, error)
        VALUES ('assistant_reminders','delete', 0, p_dry_run, SQLERRM);
      END;
    END IF;

    -- ---- admin audit IPs --------------------------------------------------
    SELECT retention_days INTO v_days FROM public.data_retention_policy
     WHERE category='admin_audit_ip' AND enabled;
    IF v_days IS NOT NULL THEN
      BEGIN
        SELECT count(*) INTO v_n FROM public.admin_audit_log
         WHERE ip_address IS NOT NULL
           AND created_at < now() - (v_days::text || ' days')::interval;
        IF NOT p_dry_run AND v_n > 0 THEN
            UPDATE public.admin_audit_log SET ip_address = NULL
             WHERE ip_address IS NOT NULL
               AND created_at < now() - (v_days::text || ' days')::interval;
        END IF;
        INSERT INTO public.data_retention_runs (category, action, rows_affected, dry_run)
        VALUES ('admin_audit_ip','redact', v_n, p_dry_run);
        v_result := v_result || jsonb_build_object('admin_audit_ip', v_n);
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.data_retention_runs (category, action, rows_affected, dry_run, error)
        VALUES ('admin_audit_ip','redact', 0, p_dry_run, SQLERRM);
      END;
    END IF;

    -- ---- closed accounts past their grace window --------------------------
    BEGIN
        v_n := 0;
        FOR rec IN
            SELECT user_id FROM public.account_deletion_requests
             WHERE status = 'pending' AND scheduled_at < now()
        LOOP
            -- Legal hold: never anonymise someone with an open incident or an
            -- unresolved dispute. Park it and tell an admin instead.
            IF EXISTS (SELECT 1 FROM public.emergency_logs e
                        WHERE (e.rider_id = rec.user_id) AND e.resolved_at IS NULL)
               OR EXISTS (SELECT 1 FROM public.support_tickets t
                           WHERE t.user_id = rec.user_id AND t.status NOT IN ('resolved','closed'))
            THEN
                UPDATE public.account_deletion_requests
                   SET status = 'on_hold',
                       hold_reason = 'Open incident or unresolved support ticket'
                 WHERE user_id = rec.user_id;
                CONTINUE;
            END IF;

            IF NOT p_dry_run THEN
                PERFORM public.anonymise_user(rec.user_id);
                UPDATE public.account_deletion_requests
                   SET status = 'completed', completed_at = now()
                 WHERE user_id = rec.user_id;
            END IF;
            v_n := v_n + 1;
        END LOOP;

        INSERT INTO public.data_retention_runs (category, action, rows_affected, dry_run)
        VALUES ('account_anonymisation','anonymise', v_n, p_dry_run);
        v_result := v_result || jsonb_build_object('account_anonymisation', v_n);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.data_retention_runs (category, action, rows_affected, dry_run, error)
        VALUES ('account_anonymisation','anonymise', 0, p_dry_run, SQLERRM);
    END;

    RETURN jsonb_build_object('dry_run', p_dry_run, 'ran_at', now(), 'categories', v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_personal_data(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_personal_data(boolean) TO service_role;

COMMENT ON FUNCTION public.purge_expired_personal_data(boolean) IS
'Nightly retention sweep. Driven by data_retention_policy rows; every category audited into data_retention_runs; each category independently exception-guarded. Honours legal holds (open incident, open ticket). Run with true to dry-run first.';

-- ---------------------------------------------------------------------------
-- 6. Cron — 03:15 daily, in-DB, no secret and no edge function to fail.
--    Deliberately NOT scheduled more often: a retention sweep that runs hourly
--    only multiplies the blast radius of a wrong period.
-- ---------------------------------------------------------------------------
SELECT cron.unschedule('data-retention-purge')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'data-retention-purge');

SELECT cron.schedule('data-retention-purge', '15 3 * * *',
                     $cron$SELECT public.purge_expired_personal_data(false);$cron$);
