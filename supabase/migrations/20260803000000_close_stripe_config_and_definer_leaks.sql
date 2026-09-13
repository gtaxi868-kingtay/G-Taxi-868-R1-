-- ═══════════════════════════════════════════════════════════════════
-- PHASE 1 — CLOSE THE OPEN DOORS (2026-08-03)
--
-- CRITICAL #1: any logged-in user could read the SERVICE ROLE KEY.
-- public.stripe_config holds a row keyed 'service_role_key' whose value is
-- a 208-char JWT beginning 'eyJ'. The table carried:
--     stripe_config_select_auth  FOR SELECT TO authenticated USING (true)
-- Proven live BEFORE the fix, by assuming an ordinary rider's identity:
--     rows readable by a plain rider .......... 2
--     rider can read the service role key ..... true
-- The anon key ships inside the rider/driver/merchant apps, so any user who
-- signed in could read that row and thereafter read or write EVERY row in
-- the database — profiles, wallets, passport numbers in passenger_details —
-- with RLS bypassed entirely.
-- Proven AFTER: rider BLOCKED, anon BLOCKED, service_role retained.
--
-- CRITICAL #2: three SECURITY DEFINER functions took a user id and never
-- checked the caller, so RLS never applied:
--   get_rider_active_driver — learn if any rider is mid-ride, and their driver
--   expire_ride             — expire anyone's searching ride (DoS)
--   generate_referral_code  — mint a code owned by someone else
-- Guard is `auth.uid() IS NOT NULL AND <id> <> auth.uid()`; the NULL arm keeps
-- service_role/cron callers working.
--
-- NOT a risk after live verification (recorded so nobody re-chases them):
--   * documents / document_chunks — flagged from baseline.sql:14699 as
--     anon-readable, but these tables DO NOT EXIST in production.
--   * receipts / verification-photos buckets — feared public; receipts is
--     private and verification-photos does not exist. Only lodging-photos
--     and web are public (0 and 1 objects, no PII).
--   * compliance_queue — correctly scoped to the owning driver.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS stripe_config_select_auth ON public.stripe_config;
REVOKE ALL ON public.stripe_config FROM anon, authenticated;
ALTER TABLE public.stripe_config FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE public.stripe_config IS
'Holds a service_role key. NEVER grant SELECT to anon or authenticated — a logged-in rider reading this row owns the entire database. Locked down 2026-08-03 after that exact exposure was proven live. Read it only from an edge function using its own env-var service client.';

CREATE OR REPLACE FUNCTION public.get_rider_active_driver(rider_uuid uuid)
RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
    SELECT driver_id FROM rides
    WHERE rider_id = rider_uuid
      AND (auth.uid() IS NULL OR rider_uuid = auth.uid())
      AND status IN ('assigned','arrived','in_progress')
      AND driver_id IS NOT NULL
    LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.expire_ride(p_ride_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_status TEXT; v_rider uuid;
BEGIN
    SELECT status, rider_id INTO v_status, v_rider FROM public.rides WHERE id = p_ride_id;
    IF v_status IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Ride not found'); END IF;
    IF auth.uid() IS NOT NULL AND v_rider <> auth.uid() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not your ride');
    END IF;
    IF v_status NOT IN ('requested','searching') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ride is already assigned or terminal');
    END IF;
    UPDATE public.rides SET status = 'expired', updated_at = NOW() WHERE id = p_ride_id;
    RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_referral_code(p_user_id uuid, p_type text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_code TEXT; v_attempts INT := 0;
BEGIN
    IF auth.uid() IS NOT NULL AND p_user_id <> auth.uid() THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;
    LOOP
        v_code := upper(substring(md5(p_user_id::text || clock_timestamp()::text) from 1 for 6));
        EXIT WHEN NOT EXISTS (SELECT 1 FROM referral_codes WHERE code = v_code);
        v_attempts := v_attempts + 1;
        IF v_attempts > 20 THEN RAISE EXCEPTION 'Could not generate unique code'; END IF;
    END LOOP;
    INSERT INTO referral_codes (user_id, code, type) VALUES (p_user_id, v_code, p_type)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN v_code;
END;
$function$;
