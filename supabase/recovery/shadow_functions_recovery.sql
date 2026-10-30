-- =====================================================================
-- G868 SHADOW FUNCTIONS RECOVERY — extracted from the LIVE database
-- Project: ffbbuafgeypvkpcuvdnv ("G Taxi DATA BASE")  Date: 2026-10-30
-- Purpose: disaster-recovery record of procedure definitions that exist
-- ONLY in the live database and nowhere in the repo (67) or only on
-- unmerged branches (10) — 77 names total.
-- USE ONLY on a fresh rebuild-from-repo, AFTER the repo migrations run,
-- to restore what the repo would otherwise silently lose.
-- APPLYING THESE TO THE CURRENT LIVE DATABASE IS NOT NEEDED AND NOT ADVISED.
-- Statements are reproduced exactly as pg_get_functiondef returned them.
-- Count: 77 names. Per-name files live in ../functions/ beside this file's folder.
-- =====================================================================

-- ===== _debug_probe_notify_admins =====
-- overload: _debug_probe_notify_admins(p_body jsonb)
CREATE OR REPLACE FUNCTION public._debug_probe_notify_admins(p_body jsonb)
 RETURNS TABLE(status_code integer, content text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id bigint;
  v_tries int := 0;
begin
  select net.http_post(
    url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/notify_admins',
    headers := jsonb_build_object('x-cron-secret', public.platform_cron_secret(), 'Content-Type', 'application/json'),
    body := p_body,
    timeout_milliseconds := 20000
  ) into v_id;

  loop
    perform pg_sleep(1);
    select r.status_code, r.content::text into status_code, content
    from net._http_response r where r.id = v_id;
    v_tries := v_tries + 1;
    exit when status_code is not null or v_tries > 10;
  end loop;

  return next;
end;
$function$;


-- ===== admin_decide_partner_usage =====
-- overload: admin_decide_partner_usage(p_usage_id uuid, p_admin_id uuid, p_decision text, p_dispute_reason text)
CREATE OR REPLACE FUNCTION public.admin_decide_partner_usage(p_usage_id uuid, p_admin_id uuid, p_decision text, p_dispute_reason text DEFAULT NULL::text)
 RETURNS driver_partner_usage
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_row public.driver_partner_usage;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;
    IF p_decision NOT IN ('confirmed', 'disputed') THEN
        RAISE EXCEPTION 'p_decision must be confirmed or disputed';
    END IF;

    SELECT * INTO v_row FROM public.driver_partner_usage WHERE id = p_usage_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Usage record not found';
    END IF;
    IF v_row.status <> 'claimed' THEN
        RAISE EXCEPTION 'Usage record already decided (status=%)', v_row.status;
    END IF;

    IF p_decision = 'confirmed' THEN
        UPDATE public.service_partners
        SET commission_owed_cents = commission_owed_cents + v_row.commission_cents, updated_at = now()
        WHERE id = v_row.partner_id;
    END IF;

    UPDATE public.driver_partner_usage
    SET status = p_decision,
        dispute_reason = CASE WHEN p_decision = 'disputed' THEN p_dispute_reason ELSE NULL END,
        confirmed_at = CASE WHEN p_decision = 'confirmed' THEN now() ELSE NULL END,
        confirmed_by = p_admin_id
    WHERE id = p_usage_id
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$function$;


-- ===== admin_get_tax_position =====
-- overload: admin_get_tax_position()
CREATE OR REPLACE FUNCTION public.admin_get_tax_position()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_platform uuid := '00000000-0000-0000-0000-000000000000';
    v_rev_12m bigint;
    v_rev_month bigint;
    v_vat_threshold bigint := 60000000; -- TT$600,000 in cents
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    SELECT COALESCE(sum(amount), 0) INTO v_rev_12m
    FROM public.wallet_transactions
    WHERE user_id = v_platform AND amount > 0
      AND created_at >= now() - interval '12 months';

    SELECT COALESCE(sum(amount), 0) INTO v_rev_month
    FROM public.wallet_transactions
    WHERE user_id = v_platform AND amount > 0
      AND created_at >= date_trunc('month', now());

    RETURN jsonb_build_object(
        'platform_revenue_12m_cents', v_rev_12m,
        'platform_revenue_month_cents', v_rev_month,
        'vat_registration_threshold_cents', v_vat_threshold,
        'vat_registration_required', v_rev_12m >= v_vat_threshold,
        'pct_of_vat_threshold', round(v_rev_12m::numeric / v_vat_threshold * 100, 2),
        'vat_if_registered_cents', round(v_rev_12m * 0.125),
        'green_fund_levy_cents', round(v_rev_12m * 0.003),
        'business_levy_cents', round(v_rev_12m * 0.005),
        'notes', 'VAT applies to platform commission only (agency model); passenger taxi fares are VAT-exempt under Sch.2. Delivery fees are standard-rated. Figures are accruals on ledgered platform revenue, not tax advice.'
    );
END;
$function$;


-- ===== admin_process_kickback_payout =====
-- overload: admin_process_kickback_payout(p_recipient_type text, p_recipient_id uuid, p_admin_id uuid)
CREATE OR REPLACE FUNCTION public.admin_process_kickback_payout(p_recipient_type text, p_recipient_id uuid, p_admin_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_total_cents INTEGER := 0;
  v_ride_count  INTEGER := 0;
  v_name        TEXT;
  v_payout_id   UUID;
BEGIN
  IF p_recipient_type NOT IN ('commander','vendor') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid recipient_type. Must be commander or vendor.');
  END IF;

  IF p_recipient_type = 'commander' THEN
    WITH paid AS (
      UPDATE commander_revshare_ledger SET status='paid', paid_at=NOW()
      WHERE commander_id = p_recipient_id AND status='pending'
      RETURNING revshare_cents
    )
    SELECT COALESCE(SUM(revshare_cents),0), COUNT(*) INTO v_total_cents, v_ride_count FROM paid;

    SELECT COALESCE(p.full_name, 'Commander ' || LEFT(p_recipient_id::text,8)) INTO v_name
    FROM pod_commanders pc LEFT JOIN profiles p ON p.id = pc.user_id WHERE pc.id = p_recipient_id;
  ELSE
    WITH paid AS (
      UPDATE vendor_commissions SET status='paid'
      WHERE merchant_id = p_recipient_id AND status='pending'
      RETURNING commission_cents
    )
    SELECT COALESCE(SUM(commission_cents),0), COUNT(*) INTO v_total_cents, v_ride_count FROM paid;

    SELECT COALESCE(name, 'Merchant ' || LEFT(p_recipient_id::text,8)) INTO v_name
    FROM merchants WHERE id = p_recipient_id;
  END IF;

  IF v_ride_count = 0 OR v_total_cents <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No pending kickbacks for this recipient');
  END IF;

  INSERT INTO revshare_payouts (ledger_type, organizer_id, organizer_name, total_cents, ride_count, status, processed_by)
  VALUES (p_recipient_type, p_recipient_id, COALESCE(v_name,'Unknown'), v_total_cents, v_ride_count, 'completed', p_admin_id)
  RETURNING id INTO v_payout_id;

  RETURN jsonb_build_object('success', true, 'payout_id', v_payout_id,
    'total_cents', v_total_cents, 'ride_count', v_ride_count, 'organizer_name', v_name);
END;
$function$;


-- ===== admin_set_merchant_credit_limit =====
-- overload: admin_set_merchant_credit_limit(p_merchant_id uuid, p_credit_limit_cents integer)
CREATE OR REPLACE FUNCTION public.admin_set_merchant_credit_limit(p_merchant_id uuid, p_credit_limit_cents integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized: admin role required';
    END IF;

    IF p_credit_limit_cents IS NULL OR p_credit_limit_cents < 0 THEN
        RAISE EXCEPTION 'credit_limit_cents must be a non-negative integer';
    END IF;

    UPDATE public.merchants
    SET credit_limit_cents = p_credit_limit_cents
    WHERE id = p_merchant_id;
END;
$function$;


-- ===== admin_set_partner_service =====
-- overload: admin_set_partner_service(p_admin_id uuid, p_id uuid, p_partner_id uuid, p_name text, p_price_cents integer, p_driver_discount_pct numeric, p_is_active boolean)
CREATE OR REPLACE FUNCTION public.admin_set_partner_service(p_admin_id uuid, p_id uuid, p_partner_id uuid, p_name text, p_price_cents integer, p_driver_discount_pct numeric, p_is_active boolean)
 RETURNS partner_services
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_row public.partner_services;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;
    IF p_name IS NULL OR trim(p_name) = '' THEN
        RAISE EXCEPTION 'p_name is required';
    END IF;
    IF p_price_cents IS NULL OR p_price_cents <= 0 THEN
        RAISE EXCEPTION 'p_price_cents must be positive';
    END IF;
    IF p_driver_discount_pct IS NULL OR p_driver_discount_pct <= 0 OR p_driver_discount_pct > 50 THEN
        RAISE EXCEPTION 'p_driver_discount_pct must be between 0 and 50';
    END IF;

    IF p_id IS NULL THEN
        IF p_partner_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.service_partners WHERE id = p_partner_id) THEN
            RAISE EXCEPTION 'p_partner_id must reference an existing service_partners row';
        END IF;
        INSERT INTO public.partner_services (
            partner_id, name, price_cents, driver_discount_pct, is_active
        ) VALUES (
            p_partner_id, p_name, p_price_cents, p_driver_discount_pct, COALESCE(p_is_active, true)
        )
        RETURNING * INTO v_row;
    ELSE
        UPDATE public.partner_services
        SET name = p_name, price_cents = p_price_cents, driver_discount_pct = p_driver_discount_pct,
            is_active = COALESCE(p_is_active, is_active), updated_at = now()
        WHERE id = p_id
        RETURNING * INTO v_row;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'partner_services row % not found', p_id;
        END IF;
    END IF;

    RETURN v_row;
END;
$function$;


-- ===== admin_set_service_partner =====
-- overload: admin_set_service_partner(p_admin_id uuid, p_id uuid, p_name text, p_category text, p_phone text, p_whatsapp text, p_territory_id uuid, p_commission_pct numeric, p_is_active boolean)
CREATE OR REPLACE FUNCTION public.admin_set_service_partner(p_admin_id uuid, p_id uuid, p_name text, p_category text, p_phone text, p_whatsapp text, p_territory_id uuid, p_commission_pct numeric, p_is_active boolean)
 RETURNS service_partners
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_row public.service_partners;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;
    IF p_name IS NULL OR trim(p_name) = '' THEN
        RAISE EXCEPTION 'p_name is required';
    END IF;
    IF p_commission_pct IS NULL OR p_commission_pct <= 0 OR p_commission_pct > 50 THEN
        RAISE EXCEPTION 'p_commission_pct must be between 0 and 50';
    END IF;

    IF p_id IS NULL THEN
        INSERT INTO public.service_partners (
            name, category, phone, whatsapp, territory_id, commission_pct, is_active
        ) VALUES (
            p_name, p_category, p_phone, p_whatsapp, p_territory_id, p_commission_pct, COALESCE(p_is_active, true)
        )
        RETURNING * INTO v_row;
    ELSE
        UPDATE public.service_partners
        SET name = p_name, category = p_category, phone = p_phone, whatsapp = p_whatsapp,
            territory_id = p_territory_id, commission_pct = p_commission_pct,
            is_active = COALESCE(p_is_active, is_active), updated_at = now()
        WHERE id = p_id
        RETURNING * INTO v_row;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'service_partners row % not found', p_id;
        END IF;
    END IF;

    RETURN v_row;
END;
$function$;


-- ===== admin_set_vertical_emergency =====
-- overload: admin_set_vertical_emergency(p_id uuid, p_emergency_disabled boolean)
CREATE OR REPLACE FUNCTION public.admin_set_vertical_emergency(p_id uuid, p_emergency_disabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_role TEXT;
BEGIN
    SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
    IF v_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Unauthorized: admin role required';
    END IF;

    UPDATE vertical_settings SET
        emergency_disabled = p_emergency_disabled,
        updated_at         = now(),
        enabled_by         = auth.uid()
    WHERE id = p_id;
END;
$function$;


-- ===== admin_settle_partner_commission =====
-- overload: admin_settle_partner_commission(p_partner_id uuid, p_admin_id uuid, p_amount_collected_cents integer, p_note text)
CREATE OR REPLACE FUNCTION public.admin_settle_partner_commission(p_partner_id uuid, p_admin_id uuid, p_amount_collected_cents integer, p_note text DEFAULT NULL::text)
 RETURNS service_partners
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_row public.service_partners;
    v_admin_email text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;
    IF p_amount_collected_cents IS NULL OR p_amount_collected_cents <= 0 THEN
        RAISE EXCEPTION 'p_amount_collected_cents must be positive';
    END IF;

    UPDATE public.service_partners
    SET commission_owed_cents = GREATEST(0, commission_owed_cents - p_amount_collected_cents), updated_at = now()
    WHERE id = p_partner_id
    RETURNING * INTO v_row;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'service_partners row % not found', p_partner_id;
    END IF;

    SELECT email INTO v_admin_email FROM public.profiles WHERE id = p_admin_id;

    INSERT INTO public.admin_audit_log (admin_id, admin_email, action, target_type, target_id, reason, metadata)
    VALUES (
        p_admin_id, v_admin_email, 'partner_commission_settled', 'service_partner', p_partner_id::text,
        p_note, jsonb_build_object('amount_collected_cents', p_amount_collected_cents, 'balance_after_cents', v_row.commission_owed_cents)
    );

    RETURN v_row;
END;
$function$;


-- ===== admin_update_withdrawal_status =====
-- overload: admin_update_withdrawal_status(p_withdrawal_id uuid, p_status text)
CREATE OR REPLACE FUNCTION public.admin_update_withdrawal_status(p_withdrawal_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (SELECT role::text FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Forbidden');
  END IF;

  UPDATE public.withdrawal_requests
  SET status = p_status,
      completed_at = CASE WHEN p_status IN ('completed', 'failed') THEN NOW() ELSE completed_at END
  WHERE id = p_withdrawal_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Withdrawal request not found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$;


-- ===== apply_for_driver_lease =====
-- overload: apply_for_driver_lease(p_driver_id uuid, p_fleet_vehicle_id uuid, p_daily_deduction_cents integer, p_total_lease_cents integer, p_national_id text, p_date_of_birth date, p_residential_address text)
CREATE OR REPLACE FUNCTION public.apply_for_driver_lease(p_driver_id uuid, p_fleet_vehicle_id uuid DEFAULT NULL::uuid, p_daily_deduction_cents integer DEFAULT 15000, p_total_lease_cents integer DEFAULT NULL::integer, p_national_id text DEFAULT NULL::text, p_date_of_birth date DEFAULT NULL::date, p_residential_address text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_driver record;
    v_vehicle record;
    v_lease_id uuid;
    v_avg_ride_value integer;
    v_weekly_avg_rides integer;
    v_vehicle_make text;
    v_vehicle_model text;
    v_vehicle_year integer;
BEGIN
    -- Validate driver exists
    SELECT * INTO v_driver FROM public.drivers WHERE id = p_driver_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Driver not found');
    END IF;

    -- Validate vehicle — ONLY when one was supplied. WS2 repair
    -- (2026-10-29): the consent flow (LeaseConsentScreen ->
    -- apply_for_lease) applies BEFORE a specific vehicle is assigned and
    -- legitimately sends fleet_vehicle_id NULL; the old unconditional
    -- check rejected every such application ("Vehicle not found" behind
    -- the edge function's 400). Vehicle assignment happens at approval
    -- (approve_driver_lease). A supplied-but-unknown vehicle still fails.
    IF p_fleet_vehicle_id IS NOT NULL THEN
        SELECT * INTO v_vehicle FROM public.fleet_vehicles WHERE id = p_fleet_vehicle_id;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'Vehicle not found');
        END IF;
        v_vehicle_make := v_vehicle.make;
        v_vehicle_model := v_vehicle.model;
        v_vehicle_year := v_vehicle.year;
    END IF;

    -- Check for existing active lease
    IF EXISTS (SELECT 1 FROM public.driver_leases WHERE driver_id = p_driver_id AND status = 'active') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Driver already has an active lease');
    END IF;

    -- Check eligibility: 500+ completed rides, 4.8+ rating
    SELECT COUNT(*)::integer, COALESCE(AVG(r.total_fare_cents), 0)::integer
    INTO v_weekly_avg_rides, v_avg_ride_value
    FROM public.rides r
    WHERE r.driver_id = p_driver_id
      AND r.status = 'completed'
      AND r.completed_at > now() - interval '90 days';

    IF v_driver.rating < 4.8 OR (SELECT COUNT(*) FROM public.rides WHERE driver_id = p_driver_id AND status = 'completed') < 500 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Not eligible: requires 500+ completed rides and 4.8+ rating',
            'completed_rides', (SELECT COUNT(*) FROM public.rides WHERE driver_id = p_driver_id AND status = 'completed'),
            'rating', v_driver.rating
        );
    END IF;

    -- Calculate total lease if not provided
    IF p_total_lease_cents IS NULL AND p_fleet_vehicle_id IS NOT NULL THEN
        p_total_lease_cents := v_vehicle.acquisition_cost_cents;
    END IF;

    -- Create lease record
    INSERT INTO public.driver_leases (
        driver_id, fleet_vehicle_id, lease_provider, daily_deduction_cents,
        total_lease_cents, status, auto_deduct_enabled,
        national_id, date_of_birth, residential_address
    ) VALUES (
        p_driver_id, p_fleet_vehicle_id, 'term_finance', p_daily_deduction_cents,
        p_total_lease_cents, 'pending', true,
        p_national_id, p_date_of_birth, p_residential_address
    ) RETURNING id INTO v_lease_id;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'lease_id', v_lease_id,
            'driver_id', p_driver_id,
            'vehicle', CASE WHEN p_fleet_vehicle_id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('make', v_vehicle_make, 'model', v_vehicle_model, 'year', v_vehicle_year) END,
            'daily_deduction_cents', p_daily_deduction_cents,
            'total_lease_cents', p_total_lease_cents,
            'estimated_payoff_days', CEIL(p_total_lease_cents::numeric / p_daily_deduction_cents),
            'weekly_avg_rides', v_weekly_avg_rides,
            'avg_ride_value_cents', v_avg_ride_value,
            'status', 'pending',
            'proof_of_income', jsonb_build_object(
                'rating', v_driver.rating,
                'total_rides', (SELECT COUNT(*) FROM public.rides WHERE driver_id = p_driver_id AND status = 'completed'),
                'weekly_avg_rides', v_weekly_avg_rides,
                'avg_ride_value_cents', v_avg_ride_value,
                'current_vehicle', v_driver.vehicle_model,
                'driver_since', v_driver.created_at
            )
        )
    );
END;
$function$;


-- ===== approve_compliance_document =====
-- overload: approve_compliance_document(p_queue_id uuid, p_reviewer_id uuid, p_new_expiry timestamp with time zone)
CREATE OR REPLACE FUNCTION public.approve_compliance_document(p_queue_id uuid, p_reviewer_id uuid, p_new_expiry timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_doc record;
    v_driver_id uuid;
    v_doc_type text;
    v_expiry timestamptz;
BEGIN
    SELECT * INTO v_doc FROM public.compliance_queue WHERE id = p_queue_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Document not found'); END IF;
    IF v_doc.status != 'pending' THEN RETURN jsonb_build_object('success', false, 'error', 'Document already processed'); END IF;

    v_driver_id := v_doc.driver_id;
    v_doc_type := v_doc.document_type;
    v_expiry := COALESCE(p_new_expiry, v_doc.expiry_date);

    UPDATE public.compliance_queue
    SET status = 'approved', reviewed_by = p_reviewer_id, reviewed_at = now(), expiry_date = v_expiry
    WHERE id = p_queue_id;

    -- Update driver record based on document type
    IF v_doc_type = 'insurance' AND v_expiry IS NOT NULL THEN
        UPDATE public.drivers SET insurance_expires_at = v_expiry WHERE id = v_driver_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object('driver_id', v_driver_id, 'document_type', v_doc_type, 'expiry_date', v_expiry, 'status', 'approved')
    );
END;
$function$;


-- ===== backfill_unified_identities =====
-- overload: backfill_unified_identities()
CREATE OR REPLACE FUNCTION public.backfill_unified_identities()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_id  integer;
    v_bk  integer;
BEGIN
    INSERT INTO public.unified_identities (profile_id, tag_uid, tag_type, label, is_active, created_at, last_tapped_at)
    SELECT it.profile_id, it.tag_uid, 'identity_tag', it.tag_type, it.is_active, it.created_at, it.last_tapped_at
    FROM public.identity_tags it
    WHERE it.profile_id IS NOT NULL
    ON CONFLICT (tag_uid) DO NOTHING;
    GET DIAGNOSTICS v_id = ROW_COUNT;

    INSERT INTO public.unified_identities (profile_id, tag_uid, tag_type, label, is_active, created_at)
    SELECT bm.rider_id, bk.tag_uid, 'keychain', bk.label, bk.is_active, bk.created_at
    FROM public.band_keychains bk
    JOIN public.band_members bm ON bm.band_id = bk.band_id
    ON CONFLICT (tag_uid) DO NOTHING;
    GET DIAGNOSTICS v_bk = ROW_COUNT;

    RETURN format('Backfill complete: %s identity_tags, %s keychains', v_id, v_bk);
END;
$function$;


-- ===== bind_fleet_lease_insurance =====
-- overload: bind_fleet_lease_insurance(p_lease_id uuid, p_provider text, p_policy_number text, p_annual_premium_cents integer, p_commission_bps integer, p_expires_at timestamp with time zone, p_broker_license_ref text, p_broker_of_record text)
CREATE OR REPLACE FUNCTION public.bind_fleet_lease_insurance(p_lease_id uuid, p_provider text, p_policy_number text, p_annual_premium_cents integer, p_commission_bps integer, p_expires_at timestamp with time zone, p_broker_license_ref text, p_broker_of_record text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_lease RECORD;
  v_commission_cents integer;
  v_platform_id uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
  IF p_broker_license_ref IS NULL OR trim(p_broker_license_ref) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'broker_license_ref is required — a real licensed broker/agent must be on file before binding a policy');
  END IF;
  IF p_broker_of_record IS NULL OR trim(p_broker_of_record) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'broker_of_record is required — name the licensed entity or individual of record');
  END IF;

  IF p_annual_premium_cents IS NULL OR p_annual_premium_cents <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'annual_premium_cents must be positive');
  END IF;
  IF p_commission_bps IS NULL OR p_commission_bps < 0 OR p_commission_bps > 10000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'commission_bps must be between 0 and 10000');
  END IF;

  SELECT * INTO v_lease FROM public.fleet_leases WHERE id = p_lease_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Lease not found');
  END IF;

  IF v_lease.insurance_commission_paid AND v_lease.insurance_policy_number = p_policy_number THEN
    RETURN jsonb_build_object('success', true, 'message', 'Already bound, commission already recorded', 'commission_cents', 0);
  END IF;

  v_commission_cents := ROUND(p_annual_premium_cents * p_commission_bps / 10000.0);

  UPDATE public.fleet_leases SET
    insurance_provider = p_provider,
    insurance_policy_number = p_policy_number,
    insurance_annual_premium_cents = p_annual_premium_cents,
    insurance_commission_bps = p_commission_bps,
    insurance_bound_at = now(),
    insurance_expires_at = p_expires_at,
    insurance_commission_paid = true,
    broker_license_ref = p_broker_license_ref,
    broker_of_record = p_broker_of_record,
    updated_at = now()
  WHERE id = p_lease_id;

  IF v_commission_cents > 0 THEN
    INSERT INTO public.wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
    VALUES (v_platform_id, NULL, v_commission_cents, 'insurance_commission',
      format('Insurance brokerage commission — %s policy %s (lease %s), broker of record: %s (%s)', COALESCE(p_provider,'?'), COALESCE(p_policy_number,'?'), p_lease_id, p_broker_of_record, p_broker_license_ref),
      'completed');
  END IF;

  RETURN jsonb_build_object('success', true, 'commission_cents', v_commission_cents, 'lease_id', p_lease_id);
END;
$function$;


-- ===== calculate_escape_group_price =====
-- overload: calculate_escape_group_price(p_base_price_cents integer, p_group_size integer, p_is_subscriber boolean)
CREATE OR REPLACE FUNCTION public.calculate_escape_group_price(p_base_price_cents integer, p_group_size integer, p_is_subscriber boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_group_discount numeric := 0;
  v_subscriber_discount numeric := 0;
  v_final_discount numeric;
  v_source text;
  v_sell_price integer;
BEGIN
  IF p_base_price_cents IS NULL OR p_base_price_cents <= 0 THEN
    RAISE EXCEPTION 'calculate_escape_group_price: base_price_cents must be positive, got %', p_base_price_cents;
  END IF;
  IF p_group_size IS NULL OR p_group_size < 1 THEN
    RAISE EXCEPTION 'calculate_escape_group_price: group_size must be at least 1, got %', p_group_size;
  END IF;

  SELECT COALESCE(MAX(discount_percent), 0) INTO v_group_discount
  FROM public.group_discount_tiers
  WHERE min_group_size <= p_group_size;

  IF p_is_subscriber THEN
    SELECT COALESCE(discount_percent, 0) INTO v_subscriber_discount
    FROM public.subscription_benefits WHERE tier = 'g_member';
    v_subscriber_discount := COALESCE(v_subscriber_discount, 0);
  END IF;

  IF v_group_discount >= v_subscriber_discount THEN
    v_final_discount := v_group_discount;
    v_source := CASE WHEN v_group_discount > 0 THEN 'group' ELSE 'none' END;
  ELSE
    v_final_discount := v_subscriber_discount;
    v_source := 'subscriber';
  END IF;

  v_sell_price := ROUND(p_base_price_cents * (1 - v_final_discount / 100.0));

  RETURN jsonb_build_object(
    'sell_price_cents', v_sell_price,
    'discount_percent_applied', v_final_discount,
    'discount_source', v_source,
    'group_discount_percent', v_group_discount,
    'subscriber_discount_percent', v_subscriber_discount
  );
END;
$function$;


-- ===== calculate_escape_sell_price =====
-- overload: calculate_escape_sell_price(p_base_cost_cents integer, p_country_code text, p_is_subscriber boolean)
CREATE OR REPLACE FUNCTION public.calculate_escape_sell_price(p_base_cost_cents integer, p_country_code text, p_is_subscriber boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_rule RECORD;
  v_sell_price numeric;
BEGIN
  IF p_base_cost_cents IS NULL OR p_base_cost_cents <= 0 THEN
    RAISE EXCEPTION 'calculate_escape_sell_price: base_cost_cents must be positive, got %', p_base_cost_cents;
  END IF;

  SELECT * INTO v_rule FROM public.pricing_rules WHERE country_code = p_country_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calculate_escape_sell_price: no pricing_rules row for country_code %', p_country_code;
  END IF;

  v_sell_price := p_base_cost_cents * (1 + v_rule.markup_percent / 100.0);

  IF p_is_subscriber AND v_rule.subscriber_discount_enabled THEN
    v_sell_price := v_sell_price * (1 - v_rule.subscriber_discount_percent / 100.0);
  END IF;

  RETURN ROUND(v_sell_price)::integer;
END;
$function$;


-- ===== cancel_cash_deposit =====
-- overload: cancel_cash_deposit(p_deposit_id uuid, p_actor_user_id uuid)
CREATE OR REPLACE FUNCTION public.cancel_cash_deposit(p_deposit_id uuid, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_deposit record;
  v_is_merchant_actor boolean;
begin
  select * into v_deposit from merchant_cash_deposits where id = p_deposit_id for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;

  if v_deposit.status <> 'pending' then
    return jsonb_build_object('success', false, 'error', 'not_pending', 'status', v_deposit.status);
  end if;

  select exists (
    select 1 from merchants where id = v_deposit.merchant_id and created_by = p_actor_user_id
    union
    select 1 from merchant_staff where merchant_id = v_deposit.merchant_id and user_id = p_actor_user_id and is_active
  ) into v_is_merchant_actor;

  if p_actor_user_id <> v_deposit.driver_user_id and not v_is_merchant_actor then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;

  update merchant_cash_deposits
  set status = 'cancelled', cancelled_at = now(), cancelled_by = p_actor_user_id, updated_at = now()
  where id = p_deposit_id;

  return jsonb_build_object('success', true);
end;
$function$;


-- ===== charge_merchant_pin_fee_batch =====
-- overload: charge_merchant_pin_fee_batch(p_merchant_id uuid, p_event_ids uuid[])
CREATE OR REPLACE FUNCTION public.charge_merchant_pin_fee_batch(p_merchant_id uuid, p_event_ids uuid[])
 RETURNS TABLE(charged_count integer, failed_count integer, no_owner boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_locked_ids uuid[];
  v_total_fee integer;
  v_created_by uuid;
  v_merchant_name text;
  v_advisory_lock_id bigint;
  v_count integer;
BEGIN
  WITH locked AS (
    SELECT id, pin_fee_cents
      FROM public.arrival_events
     WHERE id = ANY(p_event_ids)
       AND merchant_id = p_merchant_id
       AND status = 'pending'
     FOR UPDATE
  )
  SELECT array_agg(id), COALESCE(SUM(pin_fee_cents), 0)
    INTO v_locked_ids, v_total_fee
    FROM locked;

  v_count := COALESCE(array_length(v_locked_ids, 1), 0);
  IF v_count = 0 THEN
    RETURN QUERY SELECT 0, 0, FALSE;
    RETURN;
  END IF;

  SELECT created_by, name INTO v_created_by, v_merchant_name
    FROM public.merchants WHERE id = p_merchant_id;

  IF v_created_by IS NULL THEN
    PERFORM public.raise_admin_alert(
      'ADMIN_OVERRIDE',
      'Merchant pin fee owed but cannot be charged — no owner account',
      format(
        '%s owes %s cents in pin fees for %s rider arrival(s) but has no linked owner account (merchants.created_by is null). The fee cannot be deducted from any wallet; link a real owner account to this merchant to resume billing.',
        COALESCE(v_merchant_name, p_merchant_id::text), v_total_fee, v_count
      ),
      'WARNING',
      jsonb_build_object(
        'merchant_id', p_merchant_id,
        'merchant_name', v_merchant_name,
        'amount_cents', v_total_fee,
        'arrival_event_ids', to_jsonb(v_locked_ids),
        'event_count', v_count,
        'reason', 'merchants.created_by is null'
      )
    );
    UPDATE public.arrival_events SET status = 'failed' WHERE id = ANY(v_locked_ids);
    RETURN QUERY SELECT 0, v_count, TRUE;
    RETURN;
  END IF;

  -- Same per-user advisory lock pattern used by process_wallet_payment_hardened
  -- and merchant_wallet_charge, so a concurrent debit against this same
  -- wallet from another path serializes rather than racing the balance read.
  v_advisory_lock_id := ('x' || substr(md5(v_created_by::text), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_advisory_lock_id);

  INSERT INTO public.wallet_transactions (id, user_id, amount, transaction_type, description, reference_id, status)
  VALUES (
    gen_random_uuid(), v_created_by, -v_total_fee, 'merchant_subscription',
    format('Pin fee for %s rider arrival(s) at your merchant location', v_count),
    format('pin_batch_%s_%s', p_merchant_id, to_char(now(), 'YYYYMMDD')),
    'completed'
  );

  INSERT INTO public.wallets (user_id, balance_cents)
  VALUES (v_created_by, -v_total_fee)
  ON CONFLICT (user_id) DO UPDATE
    SET balance_cents = GREATEST(0, public.wallets.balance_cents - v_total_fee),
        updated_at = NOW();

  UPDATE public.arrival_events
     SET status = 'charged', charged_at = NOW()
   WHERE id = ANY(v_locked_ids);

  RETURN QUERY SELECT v_count, 0, FALSE;
END;
$function$;


-- ===== check_driver_insurance_compliance =====
-- overload: check_driver_insurance_compliance(p_driver_id uuid)
CREATE OR REPLACE FUNCTION public.check_driver_insurance_compliance(p_driver_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_driver record;
BEGIN
    SELECT * INTO v_driver FROM public.drivers WHERE id = p_driver_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('compliant', false, 'error', 'Driver not found'); END IF;

    IF v_driver.insurance_expires_at IS NULL THEN
        RETURN jsonb_build_object(
            'compliant', false,
            'blocked_reason', 'insurance_not_submitted',
            'message', 'No insurance on file. Submit your certificate to activate your account.'
        );
    END IF;

    IF v_driver.insurance_expires_at < now() THEN
        RETURN jsonb_build_object(
            'compliant', false,
            'blocked_reason', 'insurance_expired',
            'expired_at', v_driver.insurance_expires_at,
            'message', 'Your insurance expired on ' || to_char(v_driver.insurance_expires_at, 'YYYY-MM-DD') || '. Upload a new certificate to resume driving.'
        );
    END IF;

    RETURN jsonb_build_object('compliant', true);
END;
$function$;


-- ===== check_escape_lane_fare_freshness =====
-- overload: check_escape_lane_fare_freshness()
CREATE OR REPLACE FUNCTION public.check_escape_lane_fare_freshness()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_stale jsonb;
  v_count integer;
  v_existing uuid;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
           'lane', origin_code || '->' || destination_code,
           'fare_cents', fare_cents, 'source_url', source_url,
           'as_of_date', as_of_date, 'days_old', (now()::date - as_of_date)
         ) ORDER BY as_of_date),
         count(*)
  INTO v_stale, v_count
  FROM public.escape_lane_fare_baseline
  WHERE is_active AND as_of_date < (now()::date - INTERVAL '14 days');

  IF v_count IS NULL OR v_count = 0 THEN
    RETURN jsonb_build_object('success', true, 'stale_lanes', 0);
  END IF;

  SELECT id INTO v_existing FROM public.g_proposed_actions
  WHERE action_type = 'lane_fare_review' AND status = 'pending' LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'stale_lanes', v_count, 'note', 'proposal already pending');
  END IF;

  INSERT INTO public.g_proposed_actions (department, action_type, title, reasoning, category, amount_cents, payload)
  VALUES (
    'ops', 'lane_fare_review',
    format('%s G-Escape lane fare(s) due for reverification', v_count),
    'These airline lane fares are the baseline escape_packages.flight_cost_per_person_cents falls back to when no live Amadeus quote is cached (AMADEUS_API_KEY is not set). They were sourced from public airline fare pages and go stale — re-check the source URL for each lane, update escape_lane_fare_baseline with the current price and today''s date to clear this. Fares living in flight_cache automatically supersede this baseline the moment a live quote is available, so this reminder only matters until Amadeus is wired.',
    'money', 0,
    jsonb_build_object('stale_lanes', v_stale)
  );

  RETURN jsonb_build_object('success', true, 'stale_lanes', v_count, 'proposal_filed', true);
END;
$function$;


-- ===== check_gps_spoof =====
-- overload: check_gps_spoof(p_driver_id uuid, p_new_lat double precision, p_new_lng double precision, p_prev_lat double precision, p_prev_lng double precision, p_prev_timestamp timestamp with time zone, p_timestamp timestamp with time zone)
CREATE OR REPLACE FUNCTION public.check_gps_spoof(p_driver_id uuid, p_new_lat double precision, p_new_lng double precision, p_prev_lat double precision, p_prev_lng double precision, p_prev_timestamp timestamp with time zone, p_timestamp timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  MAX_LEGAL_SPEED_KMH CONSTANT double precision := 110;
  v_time_delta_seconds double precision;
  v_distance_meters double precision;
  v_implied_speed_kmh double precision;
  v_orig_role text;
BEGIN
  IF p_prev_timestamp IS NULL THEN
    RETURN true;
  END IF;

  v_time_delta_seconds := GREATEST(1, EXTRACT(EPOCH FROM (p_timestamp - p_prev_timestamp)));

  v_distance_meters := ST_Distance(
    ST_SetSRID(ST_MakePoint(p_prev_lng, p_prev_lat), 4326)::geography,
    ST_SetSRID(ST_MakePoint(p_new_lng, p_new_lat), 4326)::geography
  );

  v_implied_speed_kmh := (v_distance_meters / 1000.0) / (v_time_delta_seconds / 3600.0);

  IF v_time_delta_seconds > 1
     AND v_implied_speed_kmh > MAX_LEGAL_SPEED_KMH
     AND v_time_delta_seconds <= 1800
  THEN
    INSERT INTO public.gps_spoof_log (
      driver_id, reported_lat, reported_lng, last_known_lat, last_known_lng,
      implied_speed_kmh, time_delta_seconds, distance_meters, rejection_reason
    ) VALUES (
      p_driver_id, p_new_lat, p_new_lng, p_prev_lat, p_prev_lng,
      v_implied_speed_kmh, v_time_delta_seconds, v_distance_meters, 'velocity_threshold_exceeded'
    );

    v_orig_role := auth.role();
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);
    PERFORM public.increment_spoof_flag(p_driver_id);
    PERFORM set_config('request.jwt.claim.role', v_orig_role, true);

    RETURN false;
  END IF;

  RETURN true;
END;
$function$;


-- ===== check_territory_vertical_unlocks =====
-- overload: check_territory_vertical_unlocks()
CREATE OR REPLACE FUNCTION public.check_territory_vertical_unlocks()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_territory record;
  v_threshold record;
  v_rider_count integer;
  v_already_unlocked boolean;
  v_already_pending boolean;
  v_proposals_filed integer := 0;
BEGIN
  FOR v_territory IN SELECT id, name, code FROM public.territories WHERE code IS NOT NULL LOOP
    FOR v_threshold IN SELECT vertical_name, rider_count_threshold FROM public.territory_vertical_unlock_thresholds LOOP

      SELECT COALESCE(v_territory.code = ANY(vs.enabled_regions), false)
        INTO v_already_unlocked
        FROM public.vertical_settings vs
        WHERE vs.vertical_name = v_threshold.vertical_name;

      IF v_already_unlocked THEN
        CONTINUE;
      END IF;

      SELECT EXISTS (
        SELECT 1 FROM public.g_proposed_actions
        WHERE action_type = 'unlock_territory_vertical'
          AND status = 'pending'
          AND payload->>'territory_id' = v_territory.id::text
          AND payload->>'vertical_name' = v_threshold.vertical_name
      ) INTO v_already_pending;

      IF v_already_pending THEN
        CONTINUE;
      END IF;

      SELECT COUNT(DISTINCT rider_id) INTO v_rider_count
        FROM public.rides
        WHERE territory_id = v_territory.id
          AND status IN ('completed', 'payment_confirmed', 'closed');

      IF v_rider_count >= v_threshold.rider_count_threshold THEN
        INSERT INTO public.g_proposed_actions (
          department, action_type, title, reasoning, category, payload, status, expires_at
        ) VALUES (
          'ops', 'unlock_territory_vertical',
          format('Unlock %s in %s', v_threshold.vertical_name, v_territory.name),
          format(
            '%s has %s distinct riders with a completed ride — past the %s-rider threshold for %s. The community has real demand; seed merchants and let this vertical go live there.',
            v_territory.name, v_rider_count, v_threshold.rider_count_threshold, v_threshold.vertical_name
          ),
          'config',
          jsonb_build_object(
            'territory_id', v_territory.id,
            'territory_name', v_territory.name,
            'territory_code', v_territory.code,
            'vertical_name', v_threshold.vertical_name,
            'rider_count', v_rider_count,
            'threshold', v_threshold.rider_count_threshold
          ),
          'pending', now() + interval '14 days'
        );
        v_proposals_filed := v_proposals_filed + 1;
      END IF;

    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('proposals_filed', v_proposals_filed);
END;
$function$;


-- ===== claim_partner_service =====
-- overload: claim_partner_service(p_driver_user_id uuid, p_partner_service_id uuid)
CREATE OR REPLACE FUNCTION public.claim_partner_service(p_driver_user_id uuid, p_partner_service_id uuid)
 RETURNS driver_partner_usage
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_service public.partner_services;
    v_partner public.service_partners;
    v_driver_paid_cents integer;
    v_commission_cents integer;
    v_row public.driver_partner_usage;
BEGIN
    SELECT * INTO v_service FROM public.partner_services WHERE id = p_partner_service_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Service not found or not active';
    END IF;

    SELECT * INTO v_partner FROM public.service_partners WHERE id = v_service.partner_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Partner not found or not active';
    END IF;

    v_driver_paid_cents := ROUND(v_service.price_cents * (1 - v_service.driver_discount_pct / 100.0));
    v_commission_cents := ROUND(v_driver_paid_cents * v_partner.commission_pct / 100.0);

    INSERT INTO public.driver_partner_usage (
        driver_user_id, partner_id, partner_service_id, listed_price_cents, discount_pct,
        driver_paid_cents, commission_pct, commission_cents, status
    ) VALUES (
        p_driver_user_id, v_partner.id, v_service.id, v_service.price_cents, v_service.driver_discount_pct,
        v_driver_paid_cents, v_partner.commission_pct, v_commission_cents, 'claimed'
    )
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$function$;


-- ===== cleanup_stale_trips =====
-- overload: cleanup_stale_trips(p_flag_after interval, p_close_after interval, p_dry_run boolean)
CREATE OR REPLACE FUNCTION public.cleanup_stale_trips(p_flag_after interval DEFAULT '02:00:00'::interval, p_close_after interval DEFAULT '12:00:00'::interval, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_flagged uuid[] := '{}';
    v_closed uuid[] := '{}';
    v_ride record;
BEGIN
    FOR v_ride IN
        SELECT r.id, r.updated_at,
               (SELECT max(dl.created_at)
                  FROM public.driver_locations dl
                 WHERE dl.driver_id = r.driver_id) AS last_ping
        FROM public.rides r
        WHERE r.status = 'in_progress'
    LOOP
        IF v_ride.updated_at < now() - p_flag_after
           AND (v_ride.last_ping IS NULL OR v_ride.last_ping < now() - p_flag_after) THEN
            v_flagged := array_append(v_flagged, v_ride.id);

            IF NOT p_dry_run
               AND v_ride.updated_at < now() - p_close_after
               AND (v_ride.last_ping IS NULL OR v_ride.last_ping < now() - p_close_after) THEN
                BEGIN
                    IF public.admin_update_ride_status(v_ride.id, 'cancelled') THEN
                        v_closed := array_append(v_closed, v_ride.id);
                    END IF;
                EXCEPTION WHEN OTHERS THEN
                    -- One bad row must not stop the sweep.
                    NULL;
                END;
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'dry_run', p_dry_run,
        'flagged', to_jsonb(v_flagged),
        'closed', to_jsonb(v_closed)
    );
END;
$function$;


-- ===== compute_delivery_fee_cents =====
-- overload: compute_delivery_fee_cents(p_merchant_id uuid, p_delivery_lat double precision, p_delivery_lng double precision)
CREATE OR REPLACE FUNCTION public.compute_delivery_fee_cents(p_merchant_id uuid, p_delivery_lat double precision, p_delivery_lng double precision)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_merchant     RECORD;
    v_base_cents   integer := COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'DELIVERY_FEE_BASE_CENTS'), 2500);
    v_per_km_cents integer := COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'DELIVERY_FEE_PER_KM_CENTS'), 225)
                              + public.fuel_per_km_adjustment_cents();
    v_distance_km  numeric := 0;
BEGIN
    IF p_merchant_id IS NOT NULL AND p_delivery_lat IS NOT NULL AND p_delivery_lng IS NOT NULL THEN
        SELECT lat, lng INTO v_merchant FROM public.merchants WHERE id = p_merchant_id;
        IF v_merchant.lat IS NOT NULL AND v_merchant.lng IS NOT NULL THEN
            v_distance_km := ST_DistanceSphere(
                ST_MakePoint(v_merchant.lng, v_merchant.lat),
                ST_MakePoint(p_delivery_lng, p_delivery_lat)
            ) / 1000.0;
        END IF;
    END IF;

    RETURN v_base_cents + ROUND(v_distance_km * v_per_km_cents)::integer;
END;
$function$;


-- ===== compute_territory_metrics =====
-- overload: compute_territory_metrics(p_territory_id uuid, p_since timestamp with time zone)
CREATE OR REPLACE FUNCTION public.compute_territory_metrics(p_territory_id uuid, p_since timestamp with time zone DEFAULT (now() - '7 days'::interval))
 RETURNS TABLE(total_drivers integer, active_drivers integer, total_merchants integer, active_merchants integer, total_pucks integer, live_pucks integer, rides_last_7d integer, completed_rides_last_7d integer, total_revenue_cents bigint, avg_wait_time_seconds double precision, avg_ride_fare_cents integer, avg_rating double precision, cancellation_rate double precision, driver_utilization_pct double precision, new_drivers_7d integer, new_merchants_7d integer, new_riders_7d integer, unique_riders_7d integer)
 LANGUAGE sql
 STABLE
AS $function$
  WITH
    drv AS (
      SELECT
        COUNT(*)::INTEGER AS total_drivers,
        COUNT(*) FILTER (WHERE is_online)::INTEGER AS active_drivers,
        COUNT(*) FILTER (WHERE created_at >= p_since)::INTEGER AS new_drivers_7d
      FROM public.drivers
      WHERE territory_id = p_territory_id
    ),
    mch AS (
      SELECT
        COUNT(*)::INTEGER AS total_merchants,
        COUNT(*) FILTER (WHERE is_active)::INTEGER AS active_merchants,
        COUNT(*) FILTER (WHERE created_at >= p_since)::INTEGER AS new_merchants_7d
      FROM public.merchants
      WHERE territory_id = p_territory_id
    ),
    pck AS (
      SELECT
        COUNT(*)::INTEGER AS total_pucks,
        COUNT(*) FILTER (WHERE lifecycle_status = 'live')::INTEGER AS live_pucks
      FROM public.kiosk_nodes
      WHERE territory_id = p_territory_id
    ),
    rides_agg AS (
      SELECT
        COUNT(*)::INTEGER AS rides_last_7d,
        COUNT(*) FILTER (WHERE status = 'completed')::INTEGER AS completed_rides_last_7d,
        COALESCE(SUM(total_fare_cents) FILTER (WHERE status = 'completed'), 0)::BIGINT AS total_revenue_cents,
        AVG(wait_time_seconds) FILTER (WHERE status = 'completed' AND wait_time_seconds IS NOT NULL)::DOUBLE PRECISION AS avg_wait_time_seconds,
        AVG(rating) FILTER (WHERE status = 'completed' AND rating IS NOT NULL)::DOUBLE PRECISION AS avg_rating,
        COUNT(DISTINCT rider_id) FILTER (WHERE rider_id IS NOT NULL)::INTEGER AS unique_riders_7d,
        COUNT(DISTINCT driver_id) FILTER (WHERE status IN ('in_progress', 'arrived') AND driver_id IS NOT NULL)::INTEGER AS active_on_ride
      FROM public.rides
      WHERE territory_id = p_territory_id
        AND created_at >= p_since
    )
  SELECT
    drv.total_drivers,
    drv.active_drivers,
    mch.total_merchants,
    mch.active_merchants,
    pck.total_pucks,
    pck.live_pucks,
    rides_agg.rides_last_7d,
    rides_agg.completed_rides_last_7d,
    rides_agg.total_revenue_cents,
    rides_agg.avg_wait_time_seconds,
    CASE WHEN rides_agg.completed_rides_last_7d > 0
      THEN (rides_agg.total_revenue_cents / rides_agg.completed_rides_last_7d)::INTEGER
      ELSE 0 END AS avg_ride_fare_cents,
    rides_agg.avg_rating,
    CASE WHEN rides_agg.rides_last_7d > 0
      THEN ((rides_agg.rides_last_7d - rides_agg.completed_rides_last_7d)::DOUBLE PRECISION / rides_agg.rides_last_7d)
      ELSE 0 END AS cancellation_rate,
    CASE WHEN drv.active_drivers > 0
      THEN (rides_agg.active_on_ride::DOUBLE PRECISION / drv.active_drivers)
      ELSE 0 END AS driver_utilization_pct,
    drv.new_drivers_7d,
    mch.new_merchants_7d,
    rides_agg.unique_riders_7d AS new_riders_7d,
    rides_agg.unique_riders_7d
  FROM drv, mch, pck, rides_agg;
$function$;


-- ===== compute_vehicle_class_lease_cents =====
-- overload: compute_vehicle_class_lease_cents(p_key text)
CREATE OR REPLACE FUNCTION public.compute_vehicle_class_lease_cents(p_key text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_row public.vehicle_classes;
  v_capitalized numeric;
  v_monthly_rate numeric;
  v_n integer;
  v_monthly_payment numeric;
BEGIN
  SELECT * INTO v_row FROM public.vehicle_classes WHERE key = p_key;
  IF NOT FOUND OR v_row.landed_cost_cents IS NULL OR v_row.financing_rate_pct IS NULL OR v_row.financing_term_months IS NULL THEN
    RETURN NULL;
  END IF;

  v_capitalized := v_row.landed_cost_cents * 1.15 + 180000 + 1320000;
  v_monthly_rate := v_row.financing_rate_pct / 100.0 / 12.0;
  v_n := v_row.financing_term_months;

  IF v_monthly_rate = 0 THEN
    v_monthly_payment := v_capitalized / v_n;
  ELSE
    v_monthly_payment := v_capitalized * v_monthly_rate * power(1 + v_monthly_rate, v_n)
                         / (power(1 + v_monthly_rate, v_n) - 1);
  END IF;

  RETURN round(v_monthly_payment / 30.0) + COALESCE(v_row.platform_margin_cents_per_day, 0);
END;
$function$;


-- ===== create_proxy_order =====
-- overload: create_proxy_order(p_store_name text, p_store_address text, p_pickup_lat double precision, p_pickup_lng double precision, p_delivery_lat double precision, p_delivery_lng double precision, p_delivery_address text, p_estimated_goods_cents integer, p_rider_notes text)
CREATE OR REPLACE FUNCTION public.create_proxy_order(p_store_name text, p_store_address text, p_pickup_lat double precision, p_pickup_lng double precision, p_delivery_lat double precision, p_delivery_lng double precision, p_delivery_address text, p_estimated_goods_cents integer, p_rider_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rider_id uuid := auth.uid();
  v_vouched boolean;
  v_order_id uuid;
  v_payout record;
  v_service_fee_bps integer;
  v_delivery_fee_cents integer;
  v_service_fee_cents integer;
  v_max_spend_cents integer;
  v_total_cents integer;
begin
  if p_estimated_goods_cents is null or p_estimated_goods_cents <= 0 then
    return jsonb_build_object('success', false, 'error', 'A real estimated goods price is required.');
  end if;

  select
    referred_by_rider_id is not null
    or referred_by_commander_id is not null
    or referral_source_driver_id is not null
  into v_vouched
  from public.profiles where id = v_rider_id;

  if not coalesce(v_vouched, false) then
    return jsonb_build_object(
      'success', false,
      'error', 'not_vouched',
      'detail', 'Order-from-anywhere is currently limited to riders referred by a driver, another rider, or a G-Lead.'
    );
  end if;

  v_service_fee_bps := coalesce((select value_cents from public.pricing_config where key = 'PROXY_SERVICE_FEE_BPS'), 500);

  insert into public.orders (
    rider_id, merchant_id, task_type, status, payment_method, payment_status,
    store_name, store_address, pickup_lat, pickup_lng,
    delivery_lat, delivery_lng, delivery_address, rider_notes,
    estimated_goods_cents, total_cents, delivery_fee_cents
  ) values (
    v_rider_id, null, 'proxy_purchase', 'pending', 'cash', 'cash_on_delivery',
    p_store_name, p_store_address, p_pickup_lat, p_pickup_lng,
    p_delivery_lat, p_delivery_lng, p_delivery_address, p_rider_notes,
    p_estimated_goods_cents, 0, 0
  ) returning id into v_order_id;

  select * into v_payout from public.calculate_delivery_driver_payout(v_order_id);
  v_delivery_fee_cents := v_payout.payout_cents;
  v_service_fee_cents := round((p_estimated_goods_cents + v_delivery_fee_cents) * v_service_fee_bps / 10000.0)::integer;
  v_max_spend_cents := round(p_estimated_goods_cents * 1.2)::integer;
  v_total_cents := p_estimated_goods_cents + v_delivery_fee_cents + v_service_fee_cents;

  update public.orders set
    delivery_fee_cents = v_delivery_fee_cents,
    service_fee_cents = v_service_fee_cents,
    max_spend_cents = v_max_spend_cents,
    total_cents = v_total_cents
  where id = v_order_id;

  return jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'estimated_goods_cents', p_estimated_goods_cents,
    'delivery_fee_cents', v_delivery_fee_cents,
    'service_fee_cents', v_service_fee_cents,
    'max_spend_cents', v_max_spend_cents,
    'total_cents', v_total_cents
  );
end;
$function$;


-- ===== credit_driver_payout =====
-- overload: credit_driver_payout(p_driver_user_id uuid, p_gross_cents integer, p_ride_id uuid, p_description text)
CREATE OR REPLACE FUNCTION public.credit_driver_payout(p_driver_user_id uuid, p_gross_cents integer, p_ride_id uuid, p_description text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_savings record; v_withhold_cents integer := 0; v_remaining_to_target integer;
  v_platform_id CONSTANT uuid := '00000000-0000-0000-0000-000000000000'; v_ref text;
BEGIN
  IF p_gross_cents IS NULL OR p_gross_cents <= 0 THEN RETURN; END IF;
  SELECT * INTO v_savings FROM driver_deposit_savings WHERE driver_user_id = p_driver_user_id AND status = 'active' FOR UPDATE;
  IF FOUND THEN
    v_remaining_to_target := GREATEST(v_savings.deposit_target - v_savings.amount_saved, 0);
    v_withhold_cents := LEAST(ROUND(p_gross_cents * v_savings.withhold_percentage), v_remaining_to_target);
    IF v_withhold_cents > 0 THEN
      v_ref := 'depositsave:' || v_savings.id::text || ':' || p_ride_id::text;
      INSERT INTO wallet_transactions (user_id, ride_id, amount, transaction_type, description, status, reference_id)
      VALUES (p_driver_user_id, p_ride_id, -v_withhold_cents, 'deposit_savings_withheld', 'Earn-to-Deposit savings', 'completed', v_ref);
      INSERT INTO wallet_transactions (user_id, ride_id, amount, transaction_type, description, status, reference_id)
      VALUES (v_platform_id, p_ride_id, v_withhold_cents, 'deposit_savings_escrow', 'Earn-to-Deposit escrow hold', 'completed', v_ref);
      UPDATE driver_deposit_savings SET amount_saved = amount_saved + v_withhold_cents,
        status = CASE WHEN amount_saved + v_withhold_cents >= deposit_target THEN 'ready_for_assignment' ELSE status END,
        updated_at = now() WHERE id = v_savings.id;
      INSERT INTO deposit_savings_transactions (savings_id, driver_user_id, transaction_type, amount, balance_after, gross_earnings, withhold_percentage)
      VALUES (v_savings.id, p_driver_user_id, 'withholding', v_withhold_cents, v_savings.amount_saved + v_withhold_cents, p_gross_cents, v_savings.withhold_percentage);
    END IF;
  END IF;
  INSERT INTO wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
  VALUES (p_driver_user_id, p_ride_id, p_gross_cents - v_withhold_cents, 'driver_payout', p_description, 'completed');
END;
$function$;


-- ===== driver_confirm_cash_deposit =====
-- overload: driver_confirm_cash_deposit(p_deposit_id uuid, p_driver_user_id uuid)
CREATE OR REPLACE FUNCTION public.driver_confirm_cash_deposit(p_deposit_id uuid, p_driver_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_deposit record;
  v_merchant record;
  v_merchant_balance integer;
  v_driver_balance integer;
  v_merchant_tx_id uuid;
  v_driver_tx_id uuid;
  v_ref text;
begin
  select * into v_deposit
  from merchant_cash_deposits where id = p_deposit_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;

  if v_deposit.driver_user_id <> p_driver_user_id then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;

  if v_deposit.status = 'confirmed' then
    return jsonb_build_object(
      'success', true, 'amount_cents', v_deposit.amount_cents,
      'merchant_transaction_id', v_deposit.merchant_transaction_id,
      'driver_transaction_id', v_deposit.driver_transaction_id,
      'replayed', true
    );
  end if;

  if v_deposit.status in ('cancelled', 'expired') then
    return jsonb_build_object('success', false, 'error', v_deposit.status);
  end if;

  if v_deposit.expires_at < now() then
    update merchant_cash_deposits set status = 'expired', updated_at = now() where id = p_deposit_id;
    return jsonb_build_object('success', false, 'error', 'expired');
  end if;

  select id, created_by, credit_limit_cents into v_merchant
  from merchants where id = v_deposit.merchant_id;

  if v_merchant.created_by is null then
    return jsonb_build_object('success', false, 'error', 'merchant_has_no_owner_account');
  end if;

  perform pg_advisory_xact_lock(hashtext(v_merchant.created_by::text));

  select coalesce(sum(amount), 0) into v_merchant_balance
  from wallet_transactions where user_id = v_merchant.created_by;

  if v_merchant_balance - v_deposit.amount_cents < -v_merchant.credit_limit_cents then
    return jsonb_build_object(
      'success', false, 'error', 'exceeds_credit_limit',
      'merchant_balance_cents', v_merchant_balance,
      'credit_limit_cents', v_merchant.credit_limit_cents
    );
  end if;

  v_ref := 'cashdep:' || p_deposit_id::text;

  insert into wallet_transactions (user_id, amount, currency, transaction_type, description, reference_id, status)
  values (v_merchant.created_by, -v_deposit.amount_cents, 'TTD', 'cash_deposit_float',
          coalesce(v_deposit.reference_note, 'Cash deposit float'), v_ref, 'completed')
  returning id into v_merchant_tx_id;

  insert into wallet_transactions (user_id, amount, currency, transaction_type, description, reference_id, status)
  values (p_driver_user_id, v_deposit.amount_cents, 'TTD', 'cash_deposit',
          coalesce(v_deposit.reference_note, 'Cash deposit'), v_ref, 'completed')
  returning id into v_driver_tx_id;

  select coalesce(sum(amount), 0) into v_merchant_balance
  from wallet_transactions where user_id = v_merchant.created_by;
  insert into wallets (user_id, balance_cents, updated_at)
  values (v_merchant.created_by, v_merchant_balance, now())
  on conflict (user_id) do update set balance_cents = excluded.balance_cents, updated_at = now();

  select coalesce(sum(amount), 0) into v_driver_balance
  from wallet_transactions where user_id = p_driver_user_id;
  insert into wallets (user_id, balance_cents, updated_at)
  values (p_driver_user_id, v_driver_balance, now())
  on conflict (user_id) do update set balance_cents = excluded.balance_cents, updated_at = now();

  update merchant_cash_deposits
  set status = 'confirmed', confirmed_at = now(), updated_at = now(),
      merchant_transaction_id = v_merchant_tx_id, driver_transaction_id = v_driver_tx_id
  where id = p_deposit_id;

  return jsonb_build_object(
    'success', true, 'amount_cents', v_deposit.amount_cents,
    'driver_new_balance_cents', v_driver_balance,
    'merchant_new_balance_cents', v_merchant_balance,
    'merchant_transaction_id', v_merchant_tx_id, 'driver_transaction_id', v_driver_tx_id,
    'replayed', false
  );
end;
$function$;


-- ===== driver_insurance_status =====
-- overload: driver_insurance_status()
CREATE OR REPLACE FUNCTION public.driver_insurance_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_driver_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('compliant', false, 'error', 'Unauthorized');
  END IF;
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = v_uid;
  IF v_driver_id IS NULL THEN
    RETURN jsonb_build_object('compliant', false, 'error', 'Not a registered driver');
  END IF;
  RETURN public.check_driver_insurance_compliance(v_driver_id);
END;
$function$;


-- ===== enforce_block_open_floor_and_deadline =====
-- overload: enforce_block_open_floor_and_deadline()
CREATE OR REPLACE FUNCTION public.enforce_block_open_floor_and_deadline()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_days_out integer;
  v_deadline_days integer;
BEGIN
  v_days_out := (NEW.departure_time::date - CURRENT_DATE);
  IF v_days_out < 30 THEN
    RAISE EXCEPTION 'Cannot open a block % days before departure -- 30 days is the hard floor real airlines require for group terms', v_days_out;
  END IF;

  NEW.block_opened_at := now();

  SELECT name_submission_deadline_days INTO v_deadline_days
  FROM public.carrier_policies WHERE carrier_name = '_default';

  NEW.fill_deadline_date := NEW.departure_time::date - v_deadline_days;

  RETURN NEW;
END;
$function$;


-- ===== enforce_driver_insurance_compliance =====
-- overload: enforce_driver_insurance_compliance()
CREATE OR REPLACE FUNCTION public.enforce_driver_insurance_compliance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_check jsonb;
BEGIN
  IF NEW.is_online = true THEN
    v_check := public.check_driver_insurance_compliance(NEW.id);
    IF NOT COALESCE((v_check ->> 'compliant')::boolean, false) THEN
      RAISE EXCEPTION '%', COALESCE(v_check ->> 'message',
        'Insurance not on file. Upload your insurance documents to go online.')
        USING HINT = COALESCE(v_check ->> 'blocked_reason', 'insurance_not_submitted');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;


-- ===== ensure_merchant_driver_invite_code =====
-- overload: ensure_merchant_driver_invite_code()
CREATE OR REPLACE FUNCTION public.ensure_merchant_driver_invite_code()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_code     text;
  v_attempts int := 0;
BEGIN
  -- Mirror merchant_driver_network() (20261017100000): a shop is live
  -- when COALESCE(is_active, false) AND activation_status = 'active',
  -- and its code is 'S' + 6 upper-case hex chars from md5(id || time).
  IF NEW.driver_invite_code IS NULL
     AND COALESCE(NEW.is_active, false)
     AND NEW.activation_status = 'active' THEN
    LOOP
      v_code := 'S' || upper(substring(md5(NEW.id::text || clock_timestamp()::text) from 1 for 6));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.merchants WHERE driver_invite_code = v_code);
      v_attempts := v_attempts + 1;
      IF v_attempts > 20 THEN RAISE EXCEPTION 'Could not generate unique code'; END IF;
    END LOOP;
    NEW.driver_invite_code := v_code;
  END IF;
  RETURN NEW;
END;
$function$;


-- ===== expire_stale_withdrawal_codes =====
-- overload: expire_stale_withdrawal_codes()
CREATE OR REPLACE FUNCTION public.expire_stale_withdrawal_codes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_expired integer;
    v_code record;
BEGIN
    v_expired := 0;
    FOR v_code IN
        SELECT * FROM public.cash_withdrawal_codes
        WHERE status = 'active' AND expires_at < now()
        FOR UPDATE
    LOOP
        UPDATE public.cash_withdrawal_codes
        SET status = 'expired'
        WHERE id = v_code.id;

        -- Auto-refund: credit back the amount + fee
        INSERT INTO public.wallet_transactions (
            user_id, amount, transaction_type, description, status
        ) VALUES (
            v_code.user_id,
            v_code.amount_cents + v_code.fee_cents,
            'cash_withdrawal_refund',
            format('Auto-refund: cash code %s expired — TTD $%s.%s',
                   v_code.code,
                   (v_code.amount_cents + v_code.fee_cents) / 100,
                   lpad(((v_code.amount_cents + v_code.fee_cents) % 100)::text, 2, '0')),
            'completed'
        );

        v_expired := v_expired + 1;
    END LOOP;

    RETURN v_expired;
END;
$function$;


-- ===== file_transition_bonus_proposal =====
-- overload: file_transition_bonus_proposal(p_garage_request_id uuid)
CREATE OR REPLACE FUNCTION public.file_transition_bonus_proposal(p_garage_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_req record;
    v_driver_user_id uuid;
    v_savings record;
    v_ev_daily_lease integer;
    v_ice_avg_daily_net numeric;
    v_gap_based_cents integer;
    v_cap_cents integer;
    v_monthly_bonus_cents integer;
BEGIN
    SELECT * INTO v_req FROM public.g_garage_requests WHERE id = p_garage_request_id;
    IF NOT FOUND OR v_req.status <> 'approved' THEN
        RETURN;
    END IF;

    SELECT user_id INTO v_driver_user_id FROM public.drivers WHERE id = v_req.driver_id;
    IF v_driver_user_id IS NULL THEN
        RETURN;
    END IF;

    SELECT * INTO v_savings FROM public.driver_deposit_savings
    WHERE driver_user_id = v_driver_user_id
      AND target_vehicle_class_key = v_req.vehicle_class_key
      AND status = 'ready_for_assignment'
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN; -- this driver didn't come through Earn-to-Deposit for this class
    END IF;

    -- Compute every real precondition BEFORE touching the savings row's
    -- status. A prior version marked the plan 'converted' first and only
    -- then checked whether a lease rate/earnings history existed to size a
    -- bonus from — if either was missing (e.g. this vehicle class wasn't
    -- priced yet at approval time), the plan got silently stranded in
    -- 'converted' with no bonus ever proposed and no way to retry. Leaving
    -- it untouched in 'ready_for_assignment' when we can't file a real
    -- proposal is the honest state; only advance it once we're certain we
    -- will actually file one.
    SELECT public.compute_vehicle_class_lease_cents(v_req.vehicle_class_key) INTO v_ev_daily_lease;
    IF v_ev_daily_lease IS NULL THEN
        RETURN; -- not priced yet — never fabricate a bonus against a fabricated lease rate
    END IF;

    SELECT AVG(daily_total) INTO v_ice_avg_daily_net FROM (
        SELECT date_trunc('day', created_at) AS d, SUM(amount) AS daily_total
        FROM public.wallet_transactions
        WHERE user_id = v_driver_user_id
          AND transaction_type = 'driver_payout'
          AND status = 'completed'
          AND created_at >= now() - interval '30 days'
        GROUP BY 1
    ) daily;
    IF v_ice_avg_daily_net IS NULL OR v_ice_avg_daily_net <= 0 THEN
        RETURN; -- no real earnings history to size a bonus from
    END IF;

    v_gap_based_cents := GREATEST(0, v_ev_daily_lease - v_req.requested_daily_contribution_cents) * 30;
    v_cap_cents := ROUND(v_ice_avg_daily_net * 30 * 0.15);
    v_monthly_bonus_cents := LEAST(v_gap_based_cents, v_cap_cents);
    IF v_monthly_bonus_cents <= 0 THEN
        RETURN;
    END IF;

    UPDATE public.driver_deposit_savings
    SET status = 'converted', converted_at = now(), updated_at = now()
    WHERE id = v_savings.id;

    INSERT INTO public.g_proposed_actions (
        department, action_type, title, reasoning, payload, category, amount_cents, status, expires_at
    ) VALUES (
        'fleet', 'grant_transition_bonus',
        'ICE to EV transition bonus - driver ' || v_req.driver_id::text,
        format(
            'Driver converted an Earn-to-Deposit plan (%s cents saved toward %s) into an active lease. Real EV daily lease rate (compute_vehicle_class_lease_cents) is %s cents/day vs the %s cents/day this driver already committed during savings - a %s cents/month gap, capped at 15%% of their real trailing-30-day earnings (%s cents/day avg). Proposing %s cents/month for %s months to bridge the transition.',
            v_savings.amount_saved, v_req.vehicle_class_key, v_ev_daily_lease, v_req.requested_daily_contribution_cents,
            v_gap_based_cents, round(v_ice_avg_daily_net), v_monthly_bonus_cents, 6
        ),
        jsonb_build_object(
            'driver_user_id', v_driver_user_id,
            'deposit_savings_id', v_savings.id,
            'garage_request_id', v_req.id,
            'monthly_bonus_cents', v_monthly_bonus_cents,
            'months_total', 6
        ),
        'money', v_monthly_bonus_cents * 6, 'pending', now() + interval '7 days'
    );
END;
$function$;


-- ===== fuel_per_km_adjustment_cents =====
-- overload: fuel_per_km_adjustment_cents()
CREATE OR REPLACE FUNCTION public.fuel_per_km_adjustment_cents()
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_price    integer := COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'FUEL_PRICE_CENTS'), 597);
    v_baseline integer := COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'FUEL_BASELINE_CENTS'), 597);
    v_step     integer := COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'FUEL_STEP_CENTS'), 50);
    v_per_km   integer := COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'FUEL_STEP_PER_KM_CENTS'), 10);
BEGIN
    IF v_step IS NULL OR v_step <= 0 THEN
        RETURN 0;
    END IF;
    RETURN GREATEST(0, FLOOR((v_price - v_baseline)::numeric / v_step)::integer) * v_per_km;
END;
$function$;


-- ===== fulfill_driver_payout =====
-- overload: fulfill_driver_payout(p_request_id uuid, p_admin_id uuid, p_reference text)
CREATE OR REPLACE FUNCTION public.fulfill_driver_payout(p_request_id uuid, p_admin_id uuid, p_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_driver_id uuid;
  v_amount_cents integer;
  v_auth_user_id uuid;
  v_balance integer;
BEGIN
  SELECT driver_id, amount_cents INTO v_driver_id, v_amount_cents
  FROM payout_requests
  WHERE id = p_request_id AND status = 'pending'
  FOR UPDATE;

  IF v_driver_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found or already processed');
  END IF;

  SELECT user_id INTO v_auth_user_id FROM drivers WHERE id = v_driver_id;
  IF v_auth_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Driver not found');
  END IF;

  -- re-check balance at fulfillment time, not just at request time -- the
  -- driver could have spent it in the gap between requesting and approval
  SELECT COALESCE(SUM(amount), 0) INTO v_balance FROM wallet_transactions WHERE user_id = v_auth_user_id;
  IF v_balance < v_amount_cents THEN
    RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_BALANCE', 'balance_cents', v_balance);
  END IF;

  INSERT INTO wallet_transactions (user_id, amount, transaction_type, description, reference_id, status)
  VALUES (v_auth_user_id, -v_amount_cents, 'payout', 'Manual bank transfer payout', p_request_id::text, 'completed');

  UPDATE payout_requests
  SET status = 'completed',
      admin_reference = p_reference,
      processed_by = p_admin_id,
      processed_at = now()
  WHERE id = p_request_id AND status = 'pending';

  RETURN jsonb_build_object(
    'success', true, 'request_id', p_request_id,
    'amount_cents', v_amount_cents, 'balance_cents', v_balance - v_amount_cents
  );
END;
$function$;


-- ===== g_memory_prune =====
-- overload: g_memory_prune()
CREATE OR REPLACE FUNCTION public.g_memory_prune()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_armed      boolean;
  v_candidates uuid[];
  v_deleted    integer := 0;
BEGIN
  SELECT (value #>> '{}')::boolean INTO v_armed
  FROM public.g_config WHERE key = 'memory_prune_armed';
  v_armed := coalesce(v_armed, false);

  SELECT array_agg(id) INTO v_candidates
  FROM public.g_memory
  WHERE (kind IN ('observation', 'outcome')
         AND reference_count = 0
         AND confidence < 0.6
         AND created_at < now() - interval '120 days')
     OR (superseded_by_id IS NOT NULL
         AND created_at < now() - interval '180 days');

  IF v_armed AND v_candidates IS NOT NULL THEN
    DELETE FROM public.g_memory WHERE id = ANY(v_candidates);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'armed', v_armed,
    'candidate_count', coalesce(array_length(v_candidates, 1), 0),
    'deleted_count', v_deleted
  );
END;
$function$;


-- ===== g_memory_search =====
-- overload: g_memory_search(p_query_text text, p_query_embedding text, p_scope text, p_department text, p_kinds text[], p_limit integer)
CREATE OR REPLACE FUNCTION public.g_memory_search(p_query_text text, p_query_embedding text DEFAULT NULL::text, p_scope text DEFAULT NULL::text, p_department text DEFAULT NULL::text, p_kinds text[] DEFAULT NULL::text[], p_limit integer DEFAULT 8)
 RETURNS TABLE(id uuid, title text, body text, kind text, department text, confidence numeric, created_at timestamp with time zone, retrieval_mode text, score double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_embedding vector(768) := CASE WHEN p_query_embedding IS NULL THEN NULL ELSE p_query_embedding::vector(768) END;
  v_mode      text := CASE WHEN v_embedding IS NULL THEN 'fts_only' ELSE 'hybrid' END;
  v_ids       uuid[];
  v_scores    double precision[];
BEGIN
  WITH base AS (
    SELECT m.*
    FROM public.g_memory m
    WHERE m.superseded_by_id IS NULL
      AND (m.valid_until IS NULL OR m.valid_until > now())
      AND (p_scope IS NULL OR m.scope = p_scope OR m.scope = 'platform')
      AND (p_department IS NULL OR m.department = p_department OR m.scope = 'platform')
      AND (p_kinds IS NULL OR m.kind = ANY(p_kinds))
  ),
  vec AS (
    SELECT b.id, row_number() OVER (ORDER BY b.embedding <=> v_embedding) AS rnk
    FROM base b
    WHERE v_embedding IS NOT NULL AND b.embedding IS NOT NULL
    LIMIT 200
  ),
  fts AS (
    SELECT b.id,
           row_number() OVER (
             ORDER BY ts_rank_cd(b.search_tsv, websearch_to_tsquery('english', p_query_text)) DESC
           ) AS rnk
    FROM base b
    WHERE p_query_text IS NOT NULL
      AND btrim(p_query_text) <> ''
      AND b.search_tsv @@ websearch_to_tsquery('english', p_query_text)
    LIMIT 200
  ),
  scored AS (
    SELECT
      b.id,
      (coalesce(1.0 / (60 + v.rnk), 0) + coalesce(1.0 / (60 + f.rnk), 0))
        * (1 + 0.30 * (b.kind = 'directive')::int)
        * (1 + 0.15 * (p_department IS NOT NULL AND b.department = p_department)::int)
        * exp(-extract(epoch FROM now() - b.created_at) / (86400.0 * 45))
        * b.confidence AS score
    FROM base b
    LEFT JOIN vec v ON v.id = b.id
    LEFT JOIN fts f ON f.id = b.id
    WHERE v.id IS NOT NULL OR f.id IS NOT NULL
  )
  SELECT array_agg(s.id ORDER BY s.score DESC), array_agg(s.score ORDER BY s.score DESC)
  INTO v_ids, v_scores
  FROM (SELECT * FROM scored ORDER BY score DESC LIMIT p_limit) s;

  IF v_ids IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.g_memory
  SET reference_count = reference_count + 1, last_referenced_at = now()
  WHERE g_memory.id = ANY(v_ids);

  RETURN QUERY
  SELECT m.id, m.title, m.body, m.kind, m.department, m.confidence, m.created_at,
         v_mode, v_scores[array_position(v_ids, m.id)]
  FROM public.g_memory m
  WHERE m.id = ANY(v_ids)
  ORDER BY array_position(v_ids, m.id);
END;
$function$;


-- ===== g_memory_write =====
-- overload: g_memory_write(p_scope text, p_department text, p_entity_type text, p_entity_key text, p_entity_id uuid, p_kind text, p_title text, p_body text, p_confidence numeric, p_source text, p_source_ref jsonb, p_valid_until timestamp with time zone, p_supersedes_id uuid, p_embedding text, p_embedding_model text)
CREATE OR REPLACE FUNCTION public.g_memory_write(p_scope text, p_department text, p_entity_type text, p_entity_key text, p_entity_id uuid, p_kind text, p_title text, p_body text, p_confidence numeric DEFAULT 0.70, p_source text DEFAULT 'agent_run'::text, p_source_ref jsonb DEFAULT '{}'::jsonb, p_valid_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_supersedes_id uuid DEFAULT NULL::uuid, p_embedding text DEFAULT NULL::text, p_embedding_model text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hash        text;
  v_existing_id uuid;
  v_new_id      uuid;
  v_embedding   vector(768);
BEGIN
  v_embedding := CASE WHEN p_embedding IS NULL THEN NULL ELSE p_embedding::vector(768) END;

  v_hash := md5(
    lower(coalesce(p_kind, '')) || '|' ||
    coalesce(p_scope, '') || '|' ||
    coalesce(p_department, '') || '|' ||
    coalesce(p_entity_type, '') || ':' || coalesce(p_entity_key, '') || '|' ||
    lower(btrim(coalesce(p_body, '')))
  );

  SELECT id INTO v_existing_id
  FROM public.g_memory
  WHERE content_hash = v_hash AND superseded_by_id IS NULL;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.g_memory
    SET confidence         = GREATEST(confidence, coalesce(p_confidence, confidence)),
        last_referenced_at = now(),
        reference_count    = reference_count + 1
    WHERE id = v_existing_id;
    RETURN v_existing_id;
  END IF;

  INSERT INTO public.g_memory (
    scope, department, entity_type, entity_key, entity_id, kind, title, body,
    confidence, source, source_ref, valid_until, embedding, embedding_model, content_hash
  ) VALUES (
    p_scope, p_department, p_entity_type, p_entity_key, p_entity_id, p_kind, p_title, p_body,
    coalesce(p_confidence, 0.70), p_source, coalesce(p_source_ref, '{}'::jsonb),
    p_valid_until, v_embedding, p_embedding_model, v_hash
  )
  RETURNING id INTO v_new_id;

  IF p_supersedes_id IS NOT NULL THEN
    UPDATE public.g_memory
    SET superseded_by_id = v_new_id
    WHERE id = p_supersedes_id AND superseded_by_id IS NULL;
  END IF;

  RETURN v_new_id;
END;
$function$;


-- ===== g_reactivate_cron_job =====
-- overload: g_reactivate_cron_job(p_job_name text)
CREATE OR REPLACE FUNCTION public.g_reactivate_cron_job(p_job_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_allowlist text[] := ARRAY[
    'g-dept-ops', 'g-dept-finance', 'g-dept-support', 'g-dept-content_creator', 'g-dept-fleet',
    'g-proposal-expiry', 'g-system-health-sweep', 'g-memory-prune', 'g-execute-sweep'
  ];
  v_was_active boolean;
BEGIN
  IF NOT (p_job_name = ANY(v_allowlist)) THEN
    RETURN jsonb_build_object('ok', false, 'error', format('%s is not an allowlisted job — refusing. Settlement/payout/lease/dispatch jobs are never reactivatable via this path.', p_job_name));
  END IF;

  SELECT active INTO v_was_active FROM cron.job WHERE jobname = p_job_name;
  IF v_was_active IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', format('no cron job named %s exists', p_job_name));
  END IF;

  UPDATE cron.job SET active = true WHERE jobname = p_job_name;

  RETURN jsonb_build_object('ok', true, 'job_name', p_job_name, 'was_active', v_was_active, 'now_active', true);
END;
$function$;


-- ===== g_set_config_key =====
-- overload: g_set_config_key(p_key text, p_value jsonb)
CREATE OR REPLACE FUNCTION public.g_set_config_key(p_key text, p_value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old jsonb;
  v_num numeric;
BEGIN
  IF p_key = 'g_enabled' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'g_enabled cannot be changed via this path — only a human can flip G''s own kill switch.');
  END IF;

  IF p_key = 'daily_llm_budget_usd' THEN
    v_num := (p_value #>> '{}')::numeric;
    IF v_num IS NULL OR v_num <= 0 OR v_num > 25 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'daily_llm_budget_usd must be a number between 0 and 25');
    END IF;
  ELSIF p_key = 'max_proposals_per_department_per_day' THEN
    v_num := (p_value #>> '{}')::numeric;
    IF v_num IS NULL OR v_num < 1 OR v_num > 25 OR v_num != floor(v_num) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'max_proposals_per_department_per_day must be an integer between 1 and 25');
    END IF;
  ELSIF p_key = 'memory_inject_max_items' THEN
    v_num := (p_value #>> '{}')::numeric;
    IF v_num IS NULL OR v_num < 1 OR v_num > 20 OR v_num != floor(v_num) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'memory_inject_max_items must be an integer between 1 and 20');
    END IF;
  ELSIF p_key = 'proposal_expiry_hours_low_stakes' THEN
    v_num := (p_value #>> '{}')::numeric;
    IF v_num IS NULL OR v_num < 24 OR v_num > 336 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'proposal_expiry_hours_low_stakes must be a number between 24 and 336');
    END IF;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', format('%s is not an allowlisted config key', p_key));
  END IF;

  SELECT value INTO v_old FROM public.g_config WHERE key = p_key;
  INSERT INTO public.g_config (key, value) VALUES (p_key, p_value)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  RETURN jsonb_build_object('ok', true, 'key', p_key, 'old_value', v_old, 'new_value', p_value);
END;
$function$;


-- ===== generate_cash_withdrawal_code =====
-- overload: generate_cash_withdrawal_code(p_user_id uuid, p_driver_id uuid, p_amount_cents integer, p_fee_cents integer)
CREATE OR REPLACE FUNCTION public.generate_cash_withdrawal_code(p_user_id uuid, p_driver_id uuid, p_amount_cents integer, p_fee_cents integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_balance integer;
    v_code text;
    v_total_deduct integer;
    v_wallet_txn_id uuid;
    v_code_id uuid;
BEGIN
    IF p_amount_cents < 5000 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Minimum withdrawal is TTD $50');
    END IF;

    SELECT COALESCE(SUM(amount), 0)::integer INTO v_balance
    FROM public.wallet_transactions
    WHERE user_id = p_user_id;

    v_total_deduct := p_amount_cents + p_fee_cents;

    IF v_balance < v_total_deduct THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Insufficient balance',
            'balance_cents', v_balance,
            'required_cents', v_total_deduct
        );
    END IF;

    -- Check for outstanding commission debt
    IF EXISTS (
        SELECT 1 FROM public.drivers d
        WHERE d.id = p_driver_id
          AND d.commission_debt_cents > 0
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Outstanding commission debt must be cleared before withdrawal',
            'debt_cents', (SELECT commission_debt_cents FROM public.drivers WHERE id = p_driver_id)
        );
    END IF;

    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

    -- Deduct from wallet immediately
    INSERT INTO public.wallet_transactions (user_id, amount, transaction_type, description, status)
    VALUES (p_user_id, -v_total_deduct, 'cash_withdrawal',
            format('Cash withdrawal code — TTD $%s.%s + $%s.%s fee',
                   p_amount_cents / 100, lpad((p_amount_cents % 100)::text, 2, '0'),
                   p_fee_cents / 100, lpad((p_fee_cents % 100)::text, 2, '0')),
            'completed')
    RETURNING id INTO v_wallet_txn_id;

    -- Insert the code
    INSERT INTO public.cash_withdrawal_codes (user_id, driver_id, amount_cents, code, fee_cents, expires_at)
    VALUES (p_user_id, p_driver_id, p_amount_cents, v_code, p_fee_cents, now() + interval '2 hours')
    RETURNING id INTO v_code_id;

    RETURN jsonb_build_object(
        'success', true,
        'code', v_code,
        'code_id', v_code_id,
        'amount_cents', p_amount_cents,
        'fee_cents', p_fee_cents,
        'expires_at', (now() + interval '2 hours')::text,
        'wallet_transaction_id', v_wallet_txn_id
    );
END;
$function$;


-- ===== get_commander_revshare_balance =====
-- overload: get_commander_revshare_balance(p_commander_id uuid)
CREATE OR REPLACE FUNCTION public.get_commander_revshare_balance(p_commander_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_accrued integer;
    v_already_requested integer;
BEGIN
    SELECT COALESCE(SUM(revshare_cents), 0)::integer INTO v_accrued
    FROM public.commander_revshare_ledger
    WHERE commander_id = p_commander_id
      AND status = 'pending';

    SELECT COALESCE(SUM(amount_cents), 0)::integer INTO v_already_requested
    FROM public.payout_requests
    WHERE commander_id = p_commander_id
      AND status IN ('pending', 'processing');

    RETURN GREATEST(v_accrued - v_already_requested, 0);
END;
$function$;


-- ===== get_wallet_balances =====
-- overload: get_wallet_balances(p_user_ids uuid[])
CREATE OR REPLACE FUNCTION public.get_wallet_balances(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, balance_cents bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT wt.user_id, SUM(wt.amount)::bigint AS balance_cents
  FROM wallet_transactions wt
  WHERE wt.user_id = ANY(p_user_ids)
  GROUP BY wt.user_id;
$function$;


-- ===== lock_escape_group_pricing =====
-- overload: lock_escape_group_pricing()
CREATE OR REPLACE FUNCTION public.lock_escape_group_pricing()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_block RECORD;
  v_group_size integer;
  v_discount numeric;
BEGIN
  FOR v_block IN
    SELECT id FROM public.flight_blocks
    WHERE status = 'POOLING'
      AND fill_deadline_date IS NOT NULL
      AND fill_deadline_date <= CURRENT_DATE
      AND locked_group_size IS NULL
    FOR UPDATE
  LOOP
    SELECT COALESCE(SUM(guest_count), 0) INTO v_group_size
    FROM public.package_reservations
    WHERE flight_block_id = v_block.id AND status IN ('CAPTURED', 'CONFIRMED');

    SELECT COALESCE(MAX(discount_percent), 0) INTO v_discount
    FROM public.group_discount_tiers
    WHERE min_group_size <= v_group_size;

    UPDATE public.flight_blocks
    SET locked_group_size = v_group_size,
        locked_discount_percent = v_discount,
        updated_at = now()
    WHERE id = v_block.id;
  END LOOP;
END;
$function$;


-- ===== manual_deposits_lock_claimed_amount =====
-- overload: manual_deposits_lock_claimed_amount()
CREATE OR REPLACE FUNCTION public.manual_deposits_lock_claimed_amount()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.claimed_amount_cents IS NULL THEN
            NEW.claimed_amount_cents := NEW.amount_cents;
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF OLD.claimed_amount_cents IS NOT NULL AND NEW.claimed_amount_cents IS DISTINCT FROM OLD.claimed_amount_cents THEN
            RAISE EXCEPTION 'claimed_amount_cents is immutable once set';
        END IF;
        RETURN NEW;
    END IF;
    RETURN NEW;
END;
$function$;


-- ===== merchant_initiate_cash_deposit =====
-- overload: merchant_initiate_cash_deposit(p_merchant_id uuid, p_initiated_by uuid, p_driver_user_id uuid, p_amount_cents integer, p_reference_note text, p_idempotency_key text, p_expires_minutes integer)
CREATE OR REPLACE FUNCTION public.merchant_initiate_cash_deposit(p_merchant_id uuid, p_initiated_by uuid, p_driver_user_id uuid, p_amount_cents integer, p_reference_note text, p_idempotency_key text, p_expires_minutes integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_existing record;
  v_merchant record;
  v_merchant_balance integer;
  v_pending_committed integer;
  v_deposit_id uuid;
  v_expires_at timestamptz;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    return jsonb_build_object('success', false, 'error', 'invalid_amount');
  end if;

  select * into v_existing
  from merchant_cash_deposits
  where merchant_id = p_merchant_id and idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'success', true, 'deposit_id', v_existing.id, 'status', v_existing.status,
      'expires_at', v_existing.expires_at, 'replayed', true
    );
  end if;

  perform pg_advisory_xact_lock(hashtext(p_merchant_id::text));

  update merchant_cash_deposits
  set status = 'expired', updated_at = now()
  where merchant_id = p_merchant_id and status = 'pending' and expires_at < now();

  if exists (
    select 1 from merchant_cash_deposits
    where driver_user_id = p_driver_user_id and status = 'pending' and expires_at > now()
  ) then
    return jsonb_build_object('success', false, 'error', 'driver_has_pending_deposit');
  end if;

  select id, created_by, credit_limit_cents, is_active into v_merchant
  from merchants where id = p_merchant_id;

  if not found or not v_merchant.is_active then
    return jsonb_build_object('success', false, 'error', 'merchant_not_found_or_inactive');
  end if;

  if v_merchant.created_by is null then
    return jsonb_build_object('success', false, 'error', 'merchant_has_no_owner_account');
  end if;

  select coalesce(sum(amount), 0) into v_merchant_balance
  from wallet_transactions where user_id = v_merchant.created_by;

  select coalesce(sum(amount_cents), 0) into v_pending_committed
  from merchant_cash_deposits
  where merchant_id = p_merchant_id and status = 'pending' and expires_at > now();

  if v_merchant_balance - v_pending_committed - p_amount_cents < -v_merchant.credit_limit_cents then
    return jsonb_build_object(
      'success', false, 'error', 'exceeds_credit_limit',
      'merchant_balance_cents', v_merchant_balance,
      'credit_limit_cents', v_merchant.credit_limit_cents
    );
  end if;

  v_expires_at := now() + make_interval(mins => greatest(coalesce(p_expires_minutes, 15), 1));

  insert into merchant_cash_deposits (
    merchant_id, initiated_by, driver_user_id, amount_cents,
    reference_note, idempotency_key, expires_at
  ) values (
    p_merchant_id, p_initiated_by, p_driver_user_id, p_amount_cents,
    p_reference_note, p_idempotency_key, v_expires_at
  ) returning id into v_deposit_id;

  return jsonb_build_object('success', true, 'deposit_id', v_deposit_id, 'expires_at', v_expires_at, 'replayed', false);
end;
$function$;


-- ===== normalize_carrier_name =====
-- overload: normalize_carrier_name()
CREATE OR REPLACE FUNCTION public.normalize_carrier_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  NEW.carrier_name := lower(trim(NEW.carrier_name));
  RETURN NEW;
END;
$function$;


-- ===== opt_in_deposit_savings =====
-- overload: opt_in_deposit_savings(p_driver_user_id uuid, p_target_vehicle_class_key text, p_withhold_percentage numeric)
CREATE OR REPLACE FUNCTION public.opt_in_deposit_savings(p_driver_user_id uuid, p_target_vehicle_class_key text, p_withhold_percentage numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_vc record; v_id uuid;
BEGIN
  IF p_withhold_percentage < 0.05 OR p_withhold_percentage > 0.30 THEN
    RETURN jsonb_build_object('success', false, 'error', 'withhold_percentage must be between 0.05 and 0.30');
  END IF;
  SELECT * INTO v_vc FROM vehicle_classes WHERE key = p_target_vehicle_class_key;
  IF NOT FOUND OR NOT v_vc.is_leasable OR v_vc.financing_rate_pct IS NULL OR v_vc.deposit_target_cents IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'That vehicle class is not available for Earn-to-Deposit yet');
  END IF;
  BEGIN
    INSERT INTO driver_deposit_savings (driver_user_id, target_vehicle_class_key, deposit_target, withhold_percentage)
    VALUES (p_driver_user_id, p_target_vehicle_class_key, v_vc.deposit_target_cents, p_withhold_percentage)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'You already have an active savings plan');
  END;
  RETURN jsonb_build_object('success', true, 'savings_id', v_id, 'deposit_target', v_vc.deposit_target_cents);
END;
$function$;


-- ===== pay_due_transition_bonus_installments =====
-- overload: pay_due_transition_bonus_installments()
CREATE OR REPLACE FUNCTION public.pay_due_transition_bonus_installments()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_row record;
    v_ref text;
    v_next_month integer;
    v_paid_count integer := 0;
BEGIN
    FOR v_row IN
        SELECT * FROM public.transition_bonus_schedules
        WHERE status = 'active'
          AND months_paid < months_total
          AND next_payment_due_at IS NOT NULL
          AND next_payment_due_at <= now()
        FOR UPDATE SKIP LOCKED
    LOOP
        v_next_month := v_row.months_paid + 1;
        v_ref := 'transitionbonus:' || v_row.id::text || ':m' || v_next_month;

        INSERT INTO public.wallet_transactions (user_id, amount, transaction_type, description, status, reference_id)
        VALUES (v_row.driver_user_id, v_row.monthly_bonus_cents, 'bonus',
                'ICE to EV transition bonus (month ' || v_next_month || ' of ' || v_row.months_total || ')',
                'completed', v_ref)
        ON CONFLICT DO NOTHING;

        UPDATE public.transition_bonus_schedules
        SET months_paid = v_next_month,
            next_payment_due_at = CASE WHEN v_next_month < months_total THEN now() + interval '1 month' ELSE NULL END,
            status = CASE WHEN v_next_month >= months_total THEN 'completed' ELSE 'active' END,
            updated_at = now()
        WHERE id = v_row.id;

        v_paid_count := v_paid_count + 1;
    END LOOP;

    RETURN v_paid_count;
END;
$function$;


-- ===== payout_shop_recruiter_earnings =====
-- overload: payout_shop_recruiter_earnings(p_merchant_id uuid)
CREATE OR REPLACE FUNCTION public.payout_shop_recruiter_earnings(p_merchant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_merchant      record;
  v_total         bigint;
  v_rows          integer;
  v_merchants_paid integer := 0;
  v_rows_paid      integer := 0;
  v_total_cents    bigint  := 0;
  v_skipped        jsonb   := '[]'::jsonb;
BEGIN
  FOR v_merchant IN
    SELECT m.id, m.created_by
      FROM public.merchants m
     WHERE (p_merchant_id IS NULL OR m.id = p_merchant_id)
       AND EXISTS (SELECT 1 FROM public.shop_recruiter_revshare_ledger l
                    WHERE l.merchant_id = m.id AND l.status = 'pending')
     ORDER BY m.created_at
  LOOP
    -- No owner login: the money has nowhere to land. Leave the rows
    -- 'pending' (they pay out the day an owner is linked) and report it.
    IF v_merchant.created_by IS NULL THEN
      v_skipped := v_skipped || jsonb_build_object(
        'merchant_id', v_merchant.id, 'reason', 'skipped_no_owner');
      CONTINUE;
    END IF;

    -- Lock this shop's pending rows, then total them. A second run —
    -- manual or the daily cron — sees no 'pending' rows and pays 0.
    PERFORM 1 FROM public.shop_recruiter_revshare_ledger
     WHERE merchant_id = v_merchant.id AND status = 'pending'
     FOR UPDATE;

    SELECT COALESCE(sum(revshare_cents), 0), count(*)
      INTO v_total, v_rows
      FROM public.shop_recruiter_revshare_ledger
     WHERE merchant_id = v_merchant.id AND status = 'pending';

    IF v_rows = 0 THEN
      CONTINUE;
    END IF;

    UPDATE public.shop_recruiter_revshare_ledger
       SET status = 'paid', paid_at = now()
     WHERE merchant_id = v_merchant.id AND status = 'pending';

    IF v_total > 0 THEN
      INSERT INTO public.wallet_transactions
        (user_id, amount, transaction_type, description, reference_id, status)
      VALUES
        (v_merchant.created_by, v_total::integer, 'bonus',
         'Shop recruiter earnings — 2% of fares from drivers your shop onboarded',
         'shop_recruiter_payout:' || v_merchant.id::text || ':' || gen_random_uuid()::text,
         'completed');
    END IF;

    v_merchants_paid := v_merchants_paid + 1;
    v_rows_paid      := v_rows_paid + v_rows;
    v_total_cents    := v_total_cents + v_total;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'merchants_paid', v_merchants_paid,
    'rows_paid', v_rows_paid,
    'total_cents', v_total_cents,
    'skipped_no_owner', v_skipped);
END;
$function$;


-- ===== process_nfc_payment =====
-- overload: process_nfc_payment(p_tag_uid text, p_driver_id uuid, p_method text)
CREATE OR REPLACE FUNCTION public.process_nfc_payment(p_tag_uid text, p_driver_id uuid, p_method text DEFAULT 'wallet'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_profile_id uuid;
    v_ride record;
    v_wallet_balance integer;
    v_fare_cents integer;
    v_driver_user_id uuid;
    v_result jsonb;
BEGIN
    -- 1. Authenticate the keychain
    SELECT profile_id INTO v_profile_id
    FROM public.identity_tags
    WHERE tag_uid = p_tag_uid
      AND is_active = true;

    IF v_profile_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Keychain not found or inactive');
    END IF;

    -- 2. Check for active ride with this driver
    SELECT * INTO v_ride
    FROM public.rides
    WHERE rider_id = v_profile_id
      AND driver_id = p_driver_id
      AND status IN ('assigned', 'arrived', 'in_progress')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_ride.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No active ride found with this driver');
    END IF;

    v_fare_cents := COALESCE(v_ride.total_fare_cents, 0);

    -- 3. Execute settlement based on method
    IF p_method = 'wallet' THEN
        -- Check balance via wallets table
        SELECT (COALESCE(balance_cents, 0))::integer INTO v_wallet_balance
        FROM public.wallets
        WHERE user_id = v_profile_id;

        IF v_wallet_balance < v_fare_cents THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Insufficient wallet balance',
                'wallet_balance_cents', v_wallet_balance,
                'fare_cents', v_fare_cents
            );
        END IF;

        -- Execute wallet payment
        PERFORM public.process_wallet_payment_hardened(
            p_ride_id => v_ride.id,
            p_amount => v_fare_cents,
            p_idempotency_key => 'nfc_payment_' || v_ride.id
        );

    ELSIF p_method = 'cash' THEN
        -- Mark as cash collected, settle shadow ledger
        UPDATE public.rides
        SET cash_confirmed = true
        WHERE id = v_ride.id;

    ELSIF p_method = 'card' THEN
        -- Card requires gateway authorization — return intent for client-side handling
        RETURN jsonb_build_object(
            'success', true,
            'action_required', 'card_authorization',
            'ride_id', v_ride.id,
            'amount_cents', v_fare_cents
        );
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'Unknown payment method');
    END IF;

    -- 4. Advance ride status to completed
    UPDATE public.rides
    SET status = 'completed',
        completed_at = now(),
        payment_status = 'confirmed',
        payment_method = COALESCE(p_method, 'wallet')
    WHERE id = v_ride.id
      AND status IN ('assigned', 'arrived', 'in_progress');

    -- 5. Log the NFC payment event
    INSERT INTO public.nfc_event_logs (tag_uid, profile_id, event_type, location_context)
    VALUES (p_tag_uid, v_profile_id, 'payment_settled',
        jsonb_build_object('ride_id', v_ride.id, 'method', p_method, 'amount_cents', v_fare_cents)
    );

    -- 6. Get driver user_id for settlement
    SELECT user_id INTO v_driver_user_id
    FROM public.drivers
    WHERE id = p_driver_id;

    RETURN jsonb_build_object(
        'success', true,
        'ride_id', v_ride.id,
        'method', p_method,
        'amount_cents', v_fare_cents,
        'status', 'completed'
    );
END;
$function$;


-- ===== process_proxy_purchase_settlement =====
-- overload: process_proxy_purchase_settlement(p_order_id uuid, p_driver_user_id uuid, p_actual_goods_cents integer, p_receipt_photo_url text)
CREATE OR REPLACE FUNCTION public.process_proxy_purchase_settlement(p_order_id uuid, p_driver_user_id uuid, p_actual_goods_cents integer, p_receipt_photo_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_order record;
  v_payout record;
  v_service_fee_bps integer;
  v_service_fee_cents integer;
  v_total_collected_cents integer;
  v_driver_debit_cents integer;
  v_advisory_lock_id bigint;
begin
  v_advisory_lock_id := ('x' || substr(md5(p_order_id::text), 1, 16))::bit(64)::bigint;
  if not pg_try_advisory_xact_lock(v_advisory_lock_id) then
    return jsonb_build_object('success', false, 'error', 'Order is being processed by another request');
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Order not found');
  end if;
  if v_order.task_type != 'proxy_purchase' or v_order.merchant_id is not null then
    return jsonb_build_object('success', false, 'error', 'Not a proxy-purchase order');
  end if;
  if v_order.driver_payout_status = 'paid' then
    return jsonb_build_object('success', false, 'error', 'Already settled');
  end if;

  if p_receipt_photo_url is null and v_order.receipt_photo_url is null then
    return jsonb_build_object('success', false, 'error', 'A receipt photo is required to settle a proxy purchase.');
  end if;

  if v_order.max_spend_cents is not null and p_actual_goods_cents > v_order.max_spend_cents then
    return jsonb_build_object(
      'success', false, 'error', 'over_spend_cap',
      'detail', format('Actual spend %s exceeds the agreed cap %s cents -- this needs admin review before it can settle.',
                        p_actual_goods_cents, v_order.max_spend_cents)
    );
  end if;

  select * into v_payout from public.calculate_delivery_driver_payout(p_order_id);
  v_service_fee_bps := coalesce((select value_cents from public.pricing_config where key = 'PROXY_SERVICE_FEE_BPS'), 500);
  v_service_fee_cents := round((p_actual_goods_cents + v_payout.payout_cents) * v_service_fee_bps / 10000.0)::integer;
  v_total_collected_cents := p_actual_goods_cents + v_payout.payout_cents + v_service_fee_cents;
  v_driver_debit_cents := v_service_fee_cents;

  insert into wallet_transactions (user_id, reference_id, amount, transaction_type, description, status)
  values (p_driver_user_id, 'order:' || p_order_id::text, -v_driver_debit_cents, 'commission_fee',
          format('Platform service fee on proxy purchase -- order %s (driver collected %s cents cash, kept %s)',
                 p_order_id::text, v_total_collected_cents, v_total_collected_cents - v_driver_debit_cents),
          'completed');

  update public.orders set
    actual_goods_cents = p_actual_goods_cents,
    service_fee_cents = v_service_fee_cents,
    total_cents = v_total_collected_cents,
    driver_paid_cents = v_payout.payout_cents,
    driver_payout_status = 'paid',
    delivery_driver_id = p_driver_user_id,
    cash_collected = true,
    cash_collected_at = now(),
    status = 'delivered',
    actual_delivery_at = coalesce(actual_delivery_at, now()),
    receipt_photo_url = coalesce(p_receipt_photo_url, receipt_photo_url)
  where id = p_order_id;

  insert into platform_revenue_logs (
    order_id, merchant_id, gross_amount_cents, platform_fee_cents,
    driver_payout_cents, merchant_split_cents, reserve_cents, lease_deduction_cents
  ) values (
    p_order_id, null, v_total_collected_cents, v_service_fee_cents,
    v_payout.payout_cents, 0, 0, 0
  );

  return jsonb_build_object(
    'success', true,
    'driver_payout_cents', v_payout.payout_cents,
    'service_fee_cents', v_service_fee_cents,
    'driver_debited_cents', v_driver_debit_cents,
    'total_collected_cents', v_total_collected_cents
  );
exception
  when others then
    return jsonb_build_object('success', false, 'error', sqlerrm);
end;
$function$;


-- ===== process_wallet_debit_hardened =====
-- overload: process_wallet_debit_hardened(p_user_id uuid, p_amount_cents integer, p_description text, p_ride_id uuid)
CREATE OR REPLACE FUNCTION public.process_wallet_debit_hardened(p_user_id uuid, p_amount_cents integer, p_description text DEFAULT 'Wallet debit'::text, p_ride_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(success boolean, error_message text, transaction_id uuid)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_balance INTEGER;
  v_lock_id BIGINT;
  v_txn_id UUID := gen_random_uuid();
BEGIN
  -- Validate
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RETURN QUERY SELECT FALSE, 'Invalid amount: must be positive'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- Advisory lock on user — prevents concurrent deductions for same user
  v_lock_id := ('x' || substr(md5(p_user_id::text), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_id);

  -- Lock wallet row and read balance atomically
  SELECT balance_cents INTO v_balance
  FROM public.wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  -- Check balance
  IF v_balance IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Wallet not found'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF v_balance < p_amount_cents THEN
    RETURN QUERY SELECT FALSE, format('Insufficient balance: %s cents available, %s cents required', v_balance, p_amount_cents), NULL::UUID;
    RETURN;
  END IF;

  -- Deduct from wallet cached balance
  UPDATE public.wallets
  SET balance_cents = balance_cents - p_amount_cents,
      updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Record transaction
  INSERT INTO public.wallet_transactions
    (id, user_id, ride_id, amount, transaction_type, description, status)
  VALUES
    (v_txn_id, p_user_id, p_ride_id, -p_amount_cents, 'split_payment', p_description, 'completed');

  RETURN QUERY SELECT TRUE, NULL::TEXT, v_txn_id;
EXCEPTION
  WHEN OTHERS THEN
    RETURN QUERY SELECT FALSE, SQLERRM, NULL::UUID;
END;
$function$;


-- ===== recompute_transition_bonus_cents =====
-- overload: recompute_transition_bonus_cents(p_garage_request_id uuid)
CREATE OR REPLACE FUNCTION public.recompute_transition_bonus_cents(p_garage_request_id uuid)
 RETURNS TABLE(monthly_bonus_cents integer, months_total integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_req record;
    v_driver_user_id uuid;
    v_savings record;
    v_ev_daily_lease integer;
    v_ice_avg_daily_net numeric;
    v_gap_based_cents integer;
    v_cap_cents integer;
    v_computed_cents integer;
BEGIN
    SELECT * INTO v_req FROM public.g_garage_requests WHERE id = p_garage_request_id;
    IF NOT FOUND THEN
        RETURN QUERY SELECT NULL::integer, NULL::integer, 'garage_request not found'; RETURN;
    END IF;

    SELECT user_id INTO v_driver_user_id FROM public.drivers WHERE id = v_req.driver_id;
    IF v_driver_user_id IS NULL THEN
        RETURN QUERY SELECT NULL::integer, NULL::integer, 'driver has no linked user account'; RETURN;
    END IF;

    SELECT * INTO v_savings FROM public.driver_deposit_savings
    WHERE driver_user_id = v_driver_user_id
      AND target_vehicle_class_key = v_req.vehicle_class_key
      AND status IN ('ready_for_assignment', 'converted')
    ORDER BY (status = 'converted') DESC
    LIMIT 1;
    IF NOT FOUND THEN
        RETURN QUERY SELECT NULL::integer, NULL::integer, 'no matching Earn-to-Deposit savings plan for this driver/class'; RETURN;
    END IF;

    SELECT public.compute_vehicle_class_lease_cents(v_req.vehicle_class_key) INTO v_ev_daily_lease;
    IF v_ev_daily_lease IS NULL THEN
        RETURN QUERY SELECT NULL::integer, NULL::integer, 'vehicle class not priced'; RETURN;
    END IF;

    SELECT AVG(daily_total) INTO v_ice_avg_daily_net FROM (
        SELECT date_trunc('day', created_at) AS d, SUM(amount) AS daily_total
        FROM public.wallet_transactions
        WHERE user_id = v_driver_user_id
          AND transaction_type = 'driver_payout'
          AND status = 'completed'
          AND created_at >= now() - interval '30 days'
        GROUP BY 1
    ) daily;
    IF v_ice_avg_daily_net IS NULL OR v_ice_avg_daily_net <= 0 THEN
        RETURN QUERY SELECT NULL::integer, NULL::integer, 'no trailing earnings history to size a bonus from'; RETURN;
    END IF;

    v_gap_based_cents := GREATEST(0, v_ev_daily_lease - v_req.requested_daily_contribution_cents) * 30;
    v_cap_cents := ROUND(v_ice_avg_daily_net * 30 * 0.15);
    v_computed_cents := LEAST(v_gap_based_cents, v_cap_cents);

    IF v_computed_cents <= 0 THEN
        RETURN QUERY SELECT NULL::integer, NULL::integer, 'computed bonus is zero or negative'; RETURN;
    END IF;

    RETURN QUERY SELECT v_computed_cents, 6, NULL::text;
END;
$function$;


-- ===== record_manual_booking =====
-- overload: record_manual_booking(p_flight_block_id uuid, p_booking_reference text, p_confirming_provider text, p_base_cost_cents integer, p_pnr_locator text)
CREATE OR REPLACE FUNCTION public.record_manual_booking(p_flight_block_id uuid, p_booking_reference text, p_confirming_provider text, p_base_cost_cents integer, p_pnr_locator text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_block RECORD;
  v_email_body text;
  v_travelers text;
  v_deadline_days integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  IF p_booking_reference IS NULL OR trim(p_booking_reference) = '' THEN
    RAISE EXCEPTION 'booking_reference is required';
  END IF;
  IF p_confirming_provider IS NULL OR trim(p_confirming_provider) = '' THEN
    RAISE EXCEPTION 'confirming_provider is required';
  END IF;
  IF p_base_cost_cents IS NULL OR p_base_cost_cents <= 0 THEN
    RAISE EXCEPTION 'base_cost_cents must be positive';
  END IF;

  SELECT * INTO v_block FROM public.flight_blocks WHERE id = p_flight_block_id FOR UPDATE;
  IF v_block.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Flight block not found');
  END IF;
  IF v_block.status <> 'POOLING' THEN
    RETURN jsonb_build_object('success', false, 'error', format('Flight block is %s, must be POOLING to record a booking', v_block.status));
  END IF;

  SELECT string_agg(DISTINCT pn.value #>> '{}', ', ') INTO v_travelers
  FROM public.package_reservations pr, jsonb_array_elements(COALESCE(pr.passenger_names, '[]'::jsonb)) pn
  WHERE pr.flight_block_id = p_flight_block_id AND pr.status = 'CAPTURED';

  SELECT COALESCE(
    (SELECT name_submission_deadline_days FROM public.carrier_policies WHERE carrier_name = lower(trim(p_confirming_provider))),
    (SELECT name_submission_deadline_days FROM public.carrier_policies WHERE carrier_name = '_default')
  ) INTO v_deadline_days;

  UPDATE public.flight_blocks SET
    booking_reference = p_booking_reference,
    confirming_provider = p_confirming_provider,
    pnr_locator = p_pnr_locator,
    booked_by_admin_id = auth.uid(),
    booked_at = now(),
    base_cost_cents = p_base_cost_cents,
    booking_source = 'manual_web',
    fill_deadline_date = CASE WHEN locked_group_size IS NULL THEN departure_time::date - v_deadline_days ELSE fill_deadline_date END
  WHERE id = p_flight_block_id;

  v_email_body := format(
    E'Your G-Escape trip is booked!\n\nDestination: %s\nProvider: %s\nBooking reference: %s\nDeparture: %s\nReturn: %s\nTravelers: %s\n\nWe will be in touch with your pickup details closer to departure.',
    v_block.destination_name,
    p_confirming_provider,
    p_booking_reference,
    to_char(v_block.departure_time, 'Dy, Mon DD YYYY HH24:MI'),
    COALESCE(to_char(v_block.return_time, 'Dy, Mon DD YYYY HH24:MI'), 'One-way'),
    COALESCE(v_travelers, 'Group booking')
  );

  UPDATE public.flight_blocks SET confirmation_email_body = v_email_body WHERE id = p_flight_block_id;

  RETURN jsonb_build_object('success', true, 'flight_block_id', p_flight_block_id, 'email_draft', v_email_body);
END;
$function$;


-- ===== redeem_cash_withdrawal_code =====
-- overload: redeem_cash_withdrawal_code(p_code text, p_agent_id uuid)
CREATE OR REPLACE FUNCTION public.redeem_cash_withdrawal_code(p_code text, p_agent_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_code_record record;
BEGIN
    SELECT * INTO v_code_record
    FROM public.cash_withdrawal_codes
    WHERE code = p_code
      AND status = 'active'
      AND expires_at > now()
    FOR UPDATE;

    IF v_code_record.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Code not found, expired, or already redeemed');
    END IF;

    UPDATE public.cash_withdrawal_codes
    SET status = 'redeemed',
        redeemed_at = now(),
        redeemed_by_agent_id = p_agent_id
    WHERE id = v_code_record.id;

    -- Credit the driver (payout for cash handed over)
    INSERT INTO public.wallet_transactions (
        user_id, amount, transaction_type, description, status
    ) VALUES (
        (SELECT user_id FROM public.drivers WHERE id = v_code_record.driver_id),
        v_code_record.amount_cents,
        'cash_withdrawal_payout',
        format('Cash withdrawal code %s redeemed — TTD $%s.%s',
               v_code_record.code,
               v_code_record.amount_cents / 100,
               lpad((v_code_record.amount_cents % 100)::text, 2, '0')),
        'completed'
    );

    RETURN jsonb_build_object(
        'success', true,
        'code_id', v_code_record.id,
        'amount_cents', v_code_record.amount_cents,
        'driver_id', v_code_record.driver_id,
        'redeemed_at', now()
    );
END;
$function$;


-- ===== register_unified_identity =====
-- overload: register_unified_identity(p_tag_uid text, p_tag_type text, p_label text, p_metadata jsonb)
CREATE OR REPLACE FUNCTION public.register_unified_identity(p_tag_uid text, p_tag_type text DEFAULT 'keychain'::text, p_label text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_profile_id uuid;
    v_existing   uuid;
BEGIN
    v_profile_id := auth.uid();
    IF v_profile_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
    END IF;

    INSERT INTO public.unified_identities (profile_id, tag_uid, tag_type, label, metadata)
    VALUES (v_profile_id, p_tag_uid, p_tag_type, p_label, p_metadata)
    ON CONFLICT (tag_uid) DO UPDATE SET
        last_tapped_at = now(),
        label = COALESCE(p_label, unified_identities.label),
        metadata = unified_identities.metadata || p_metadata
    RETURNING id INTO v_existing;

    RETURN jsonb_build_object(
        'success', true,
        'identity_id', v_existing,
        'profile_id', v_profile_id,
        'tag_uid', p_tag_uid
    );
END;
$function$;


-- ===== request_deposit_refund =====
-- overload: request_deposit_refund(p_driver_user_id uuid, p_reason text)
CREATE OR REPLACE FUNCTION public.request_deposit_refund(p_driver_user_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_savings record; v_days_active numeric; v_refund_pct numeric; v_refund_amount integer;
  v_retained_amount integer; v_platform_id CONSTANT uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
  SELECT * INTO v_savings FROM driver_deposit_savings
  WHERE driver_user_id = p_driver_user_id AND status IN ('active','ready_for_assignment') FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'No active savings plan'); END IF;
  v_days_active := EXTRACT(EPOCH FROM (now() - v_savings.started_at)) / 86400.0;
  v_refund_pct := CASE WHEN v_days_active <= 30 THEN 1.0 WHEN v_days_active <= 90 THEN 0.75
    WHEN v_days_active <= 180 THEN 0.50 ELSE 0.25 END;
  v_refund_amount := ROUND(v_savings.amount_saved * v_refund_pct);
  v_retained_amount := v_savings.amount_saved - v_refund_amount;
  IF v_refund_amount > 0 THEN
    INSERT INTO wallet_transactions (user_id, amount, transaction_type, description, status)
    VALUES (p_driver_user_id, v_refund_amount, 'deposit_savings_refund', COALESCE(p_reason, 'Earn-to-Deposit refund'), 'completed');
    INSERT INTO wallet_transactions (user_id, amount, transaction_type, description, status)
    VALUES (v_platform_id, -v_refund_amount, 'deposit_savings_refund', 'Earn-to-Deposit refund payout', 'completed');
  END IF;
  IF v_retained_amount > 0 THEN
    INSERT INTO wallet_transactions (user_id, amount, transaction_type, description, status)
    VALUES (v_platform_id, v_retained_amount, 'deposit_savings_forfeit', 'Earn-to-Deposit forfeited on early exit', 'completed');
  END IF;
  UPDATE driver_deposit_savings SET status = 'refunded', refunded_at = now(), refund_amount = v_refund_amount,
    retained_amount = v_retained_amount, updated_at = now() WHERE id = v_savings.id;
  INSERT INTO deposit_savings_transactions (savings_id, driver_user_id, transaction_type, amount, balance_after, metadata)
  VALUES (v_savings.id, p_driver_user_id, 'refund', v_refund_amount, 0, jsonb_build_object('days_active', v_days_active, 'refund_pct', v_refund_pct, 'retained', v_retained_amount));
  RETURN jsonb_build_object('success', true, 'refund_amount_cents', v_refund_amount, 'retained_amount_cents', v_retained_amount, 'refund_pct', v_refund_pct);
END;
$function$;


-- ===== request_lodging_quote =====
-- overload: request_lodging_quote(p_lodging_node_id uuid)
CREATE OR REPLACE FUNCTION public.request_lodging_quote(p_lodging_node_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_node record;
  v_subject text;
  v_body text;
BEGIN
  SELECT * INTO v_node FROM public.lodging_nodes WHERE id = p_lodging_node_id;
  IF v_node IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lodging node not found');
  END IF;

  v_subject := format('Rate request — %s, %s nights, up to %s guests', v_node.name, v_node.nights, v_node.max_guests);
  v_body := format(
    E'Hi,\n\nWe run group travel packages through G-Escape and would like a per-night rate for:\n\nProperty: %s\nStay length: %s nights\nGroup size: up to %s guests\n\nCould you send us your best available rate? We book in blocks and expect repeat business.\n\nThanks!',
    v_node.name, v_node.nights, v_node.max_guests);

  RETURN jsonb_build_object(
    'success', true,
    'lodging_node_id', v_node.id,
    'to', v_node.owner_email,
    'mailto_url', format('mailto:%s?subject=%s&body=%s',
      COALESCE(v_node.owner_email, ''),
      replace(v_subject, ' ', '%20'),
      replace(replace(v_body, E'\n', '%0D%0A'), ' ', '%20'))
  );
END;
$function$;


-- ===== rider_set_ride_options =====
-- overload: rider_set_ride_options(p_ride_id uuid, p_safe_entry boolean, p_entertainment_url text)
CREATE OR REPLACE FUNCTION public.rider_set_ride_options(p_ride_id uuid, p_safe_entry boolean DEFAULT NULL::boolean, p_entertainment_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
    v_uid uuid := auth.uid();
    v_ride public.rides%rowtype;
begin
    if v_uid is null then
        return jsonb_build_object('success', false, 'error', 'Please sign in again.');
    end if;

    select * into v_ride from public.rides where id = p_ride_id for update;
    if not found or v_ride.rider_id <> v_uid then
        return jsonb_build_object('success', false, 'error', 'Ride not found.');
    end if;
    if v_ride.status::text not in ('searching', 'assigned', 'arrived', 'in_progress') then
        return jsonb_build_object('success', false, 'error', 'This ride is no longer active.');
    end if;

    if p_entertainment_url is not null then
        if length(p_entertainment_url) > 500
           or p_entertainment_url !~* '^https://([a-z0-9-]+\.)*(spotify\.com|youtube\.com|youtu\.be)/' then
            return jsonb_build_object('success', false, 'error', 'Please use a Spotify or YouTube link.');
        end if;
    end if;

    update public.rides set
        safe_entry = coalesce(p_safe_entry, safe_entry),
        entertainment_url = coalesce(p_entertainment_url, entertainment_url),
        entertainment_status = case when p_entertainment_url is not null then 'pending' else entertainment_status end
    where id = p_ride_id;

    return jsonb_build_object(
        'success', true,
        'safe_entry', coalesce(p_safe_entry, v_ride.safe_entry),
        'entertainment_status', case when p_entertainment_url is not null then 'pending' else v_ride.entertainment_status end
    );
end;
$function$;


-- ===== rider_zone_status =====
-- overload: rider_zone_status()
CREATE OR REPLACE FUNCTION public.rider_zone_status()
 RETURNS TABLE(driver_count integer, zone_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_territory_id uuid;
begin
  select territory_id into v_territory_id from public.profiles where id = auth.uid();

  if v_territory_id is null then
    driver_count := 0;
    zone_name := null;
    return next;
    return;
  end if;

  select count(*)::integer into driver_count
  from public.drivers where territory_id = v_territory_id and is_verified = true;

  select name into zone_name from public.territories where id = v_territory_id;

  return next;
end;
$function$;


-- ===== send_booking_confirmation =====
-- overload: send_booking_confirmation(p_flight_block_id uuid)
CREATE OR REPLACE FUNCTION public.send_booking_confirmation(p_flight_block_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_block RECORD;
  v_res RECORD;
  v_sent_count integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  SELECT * INTO v_block FROM public.flight_blocks WHERE id = p_flight_block_id;
  IF v_block.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Flight block not found');
  END IF;
  IF v_block.booking_reference IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No booking recorded yet -- call record_manual_booking first');
  END IF;
  IF v_block.confirmation_email_sent_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Confirmation already sent at ' || v_block.confirmation_email_sent_at::text);
  END IF;

  FOR v_res IN
    SELECT DISTINCT rider_id FROM public.package_reservations
    WHERE flight_block_id = p_flight_block_id AND status = 'CAPTURED'
  LOOP
    PERFORM public.notify_user(
      v_res.rider_id, 'escape',
      'Trip confirmed: ' || COALESCE(v_block.destination_name, 'your G-Escape'),
      v_block.confirmation_email_body
    );
    v_sent_count := v_sent_count + 1;
  END LOOP;

  UPDATE public.flight_blocks SET confirmation_email_sent_at = now() WHERE id = p_flight_block_id;

  RETURN jsonb_build_object('success', true, 'notified_riders', v_sent_count);
END;
$function$;


-- ===== set_order_delivery_fee =====
-- overload: set_order_delivery_fee()
CREATE OR REPLACE FUNCTION public.set_order_delivery_fee()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_new_fee integer;
BEGIN
    IF NEW.delivery_method = 'courier'
       AND NEW.merchant_id IS NOT NULL
       AND NEW.delivery_lat IS NOT NULL
       AND NEW.delivery_lng IS NOT NULL THEN
        v_new_fee := public.compute_delivery_fee_cents(NEW.merchant_id, NEW.delivery_lat, NEW.delivery_lng);
        -- Swap the fee inside the total so the goods subtotal (total - fee)
        -- is exactly what the customer agreed to pay for the goods.
        NEW.total_cents := GREATEST(COALESCE(NEW.total_cents, 0) - COALESCE(NEW.delivery_fee_cents, 0), 0) + v_new_fee;
        NEW.delivery_fee_cents := v_new_fee;
    END IF;
    RETURN NEW;
END;
$function$;


-- ===== set_rider_territory =====
-- overload: set_rider_territory(p_territory_code text)
CREATE OR REPLACE FUNCTION public.set_rider_territory(p_territory_code text)
 RETURNS TABLE(success boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_territory_id uuid;
begin
  select id into v_territory_id
  from public.territories
  where upper(code) = upper(trim(p_territory_code)) and is_active;

  if v_territory_id is null then
    success := false; message := 'Unknown or inactive zone.'; return next; return;
  end if;

  update public.profiles set territory_id = v_territory_id where id = auth.uid();

  success := true; message := 'Zone linked.'; return next;
end;
$function$;


-- ===== stamp_driver_location_ride =====
-- overload: stamp_driver_location_ride()
CREATE OR REPLACE FUNCTION public.stamp_driver_location_ride()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NEW.ride_id IS NULL THEN
        SELECT r.id INTO NEW.ride_id
        FROM public.rides r
        WHERE r.driver_id = NEW.driver_id
          AND r.status IN ('assigned', 'arrived', 'in_progress')
        ORDER BY r.updated_at DESC
        LIMIT 1;
    END IF;
    RETURN NEW;
END;
$function$;


-- ===== start_transition_bonus_schedule =====
-- overload: start_transition_bonus_schedule(p_driver_user_id uuid, p_deposit_savings_id uuid, p_monthly_bonus_cents integer, p_months_total integer, p_proposal_id uuid)
CREATE OR REPLACE FUNCTION public.start_transition_bonus_schedule(p_driver_user_id uuid, p_deposit_savings_id uuid, p_monthly_bonus_cents integer, p_months_total integer, p_proposal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_schedule_id uuid;
    v_ref text;
    v_row_count integer;
BEGIN
    IF p_monthly_bonus_cents IS NULL OR p_monthly_bonus_cents <= 0 THEN
        RAISE EXCEPTION 'p_monthly_bonus_cents must be positive';
    END IF;

    SELECT id INTO v_schedule_id FROM public.transition_bonus_schedules
    WHERE deposit_savings_id = p_deposit_savings_id;

    IF v_schedule_id IS NULL THEN
        INSERT INTO public.transition_bonus_schedules (
            driver_user_id, deposit_savings_id, proposal_id, monthly_bonus_cents, months_total,
            months_paid, next_payment_due_at, status
        ) VALUES (
            p_driver_user_id, p_deposit_savings_id, p_proposal_id, p_monthly_bonus_cents, p_months_total,
            0, now() + interval '1 month', 'active'
        )
        RETURNING id INTO v_schedule_id;
    END IF;

    v_ref := 'transitionbonus:' || v_schedule_id::text || ':m1';

    INSERT INTO public.wallet_transactions (user_id, amount, transaction_type, description, status, reference_id)
    VALUES (p_driver_user_id, p_monthly_bonus_cents, 'bonus', 'ICE to EV transition bonus (month 1 of ' || p_months_total || ')', 'completed', v_ref)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;

    IF v_row_count > 0 THEN
        UPDATE public.transition_bonus_schedules
        SET months_paid = 1, updated_at = now()
        WHERE id = v_schedule_id AND months_paid = 0;
    END IF;

    RETURN jsonb_build_object('schedule_id', v_schedule_id, 'month_1_paid', v_row_count > 0);
END;
$function$;


-- ===== submit_driver_compliance_document =====
-- overload: submit_driver_compliance_document(p_driver_id uuid, p_document_type text, p_document_url text, p_expiry_date timestamp with time zone)
CREATE OR REPLACE FUNCTION public.submit_driver_compliance_document(p_driver_id uuid, p_document_type text, p_document_url text, p_expiry_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_queue_id uuid;
BEGIN
    IF p_document_type NOT IN ('insurance', 'license', 'vehicle_registration', 'psv_badge', 'other') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid document type');
    END IF;

    -- Invalidate any previous pending docs of same type
    UPDATE public.compliance_queue
    SET status = 'rejected', notes = 'Superseded by new submission'
    WHERE driver_id = p_driver_id
      AND document_type = p_document_type
      AND status = 'pending';

    INSERT INTO public.compliance_queue (driver_id, document_type, document_url, expiry_date)
    VALUES (p_driver_id, p_document_type, p_document_url, p_expiry_date)
    RETURNING id INTO v_queue_id;

    RETURN jsonb_build_object('success', true, 'queue_id', v_queue_id, 'status', 'pending');
END;
$function$;


-- ===== sweep_cross_zone_safety =====
-- overload: sweep_cross_zone_safety()
CREATE OR REPLACE FUNCTION public.sweep_cross_zone_safety()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_zone_cfg   jsonb;
  v_radius_m   integer;
  v_count      integer := 0;
  v_driver_name text;
  rec          record;
BEGIN
  v_zone_cfg := (SELECT value FROM public.g_config WHERE key = 'zone_awareness');
  v_radius_m := COALESCE((v_zone_cfg->>'incident_radius_m')::integer, 5000);

  FOR rec IN
    SELECT p.id AS pending_id, p.ride_id, p.driver_id,
           r.dropoff_lat, r.dropoff_lng
    FROM public.cross_zone_safety_pending p
    JOIN public.rides r ON r.id = p.ride_id
    WHERE p.escalated_at IS NULL
      AND p.expires_at < now()
      AND r.driver_safe = false
      AND r.status IN ('completed', 'closed')
    FOR UPDATE OF p SKIP LOCKED
  LOOP
    SELECT name INTO v_driver_name FROM public.drivers WHERE id = rec.driver_id;

    PERFORM public.notify_drivers_nearby(
      rec.dropoff_lat, rec.dropoff_lng, v_radius_m,
      'Driver hasn''t confirmed safety',
      'A driver dropped off in your zone 2 minutes ago and hasn''t marked themselves safe yet.',
      rec.driver_id,
      true,
      jsonb_build_object('type', 'cross_zone_safety_escalation', 'ride_id', rec.ride_id));

    PERFORM public.raise_admin_alert(
      'DRIVER_SAFETY_TIMEOUT',
      'Driver has not confirmed safety (cross-zone drop)',
      format('%s has not marked safe 2 minutes after an out-of-zone drop-off.',
             COALESCE(v_driver_name, 'A driver')),
      'HIGH',
      jsonb_build_object(
        'entity', 'ride', 'ride_id', rec.ride_id, 'driver_id', rec.driver_id,
        'zone_cross', true, 'timeout_minutes', 2));

    PERFORM public.record_zone_safety_event('no_response', rec.driver_id, rec.ride_id, NULL);

    UPDATE public.cross_zone_safety_pending SET escalated_at = now() WHERE id = rec.pending_id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;


-- ===== sync_escape_package_flight_cost =====
-- overload: sync_escape_package_flight_cost()
CREATE OR REPLACE FUNCTION public.sync_escape_package_flight_cost()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_seat_cost integer;
BEGIN
  IF NEW.flight_block_id IS NOT NULL THEN
    SELECT flight_cost_per_seat_cents INTO v_seat_cost FROM public.flight_blocks WHERE id = NEW.flight_block_id;
    IF v_seat_cost IS NOT NULL THEN
      NEW.flight_cost_per_person_cents := v_seat_cost;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;


-- ===== sync_escape_package_real_costs =====
-- overload: sync_escape_package_real_costs()
CREATE OR REPLACE FUNCTION public.sync_escape_package_real_costs()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_origin_rate integer;
  v_dest_rate integer;
  v_nights integer;
  v_max_guests integer;
  v_quoted_nightly_cents integer;
  v_quote_expires_at timestamptz;
BEGIN
  IF NEW.driver_origin_zone IS NOT NULL THEN
    SELECT payout_cents INTO v_origin_rate FROM public.driver_zone_rates WHERE zone_name = NEW.driver_origin_zone AND is_active;
    IF v_origin_rate IS NULL THEN
      RAISE EXCEPTION 'No active driver_zone_rates entry for driver_origin_zone %', NEW.driver_origin_zone;
    END IF;
    NEW.driver_origin_cost_cents := v_origin_rate;
  END IF;

  IF NEW.driver_destination_zone IS NOT NULL THEN
    SELECT payout_cents INTO v_dest_rate FROM public.driver_zone_rates WHERE zone_name = NEW.driver_destination_zone AND is_active;
    IF v_dest_rate IS NULL THEN
      RAISE EXCEPTION 'No active driver_zone_rates entry for driver_destination_zone %', NEW.driver_destination_zone;
    END IF;
    NEW.driver_destination_cost_cents := v_dest_rate;
  END IF;

  IF NEW.lodging_node_id IS NOT NULL THEN
    SELECT nights, max_guests, quoted_rate_per_night_cents, quote_expires_at
      INTO v_nights, v_max_guests, v_quoted_nightly_cents, v_quote_expires_at
      FROM public.lodging_nodes WHERE id = NEW.lodging_node_id;

    IF v_nights IS NULL OR v_max_guests IS NULL OR v_max_guests = 0 THEN
      RAISE EXCEPTION 'lodging_nodes % missing nights/max_guests for real cost sync', NEW.lodging_node_id;
    END IF;

    IF v_quoted_nightly_cents IS NULL OR v_quoted_nightly_cents <= 0
       OR v_quote_expires_at IS NULL OR v_quote_expires_at <= now() THEN
      RAISE EXCEPTION 'lodging_nodes % has no unexpired real rate quote — request one before pricing a package against this property (quoted_rate_per_night_cents/quote_expires_at)', NEW.lodging_node_id;
    END IF;

    NEW.lodging_cost_per_person_cents := ROUND((v_quoted_nightly_cents * v_nights)::numeric / v_max_guests);
  END IF;

  RETURN NEW;
END;
$function$;


-- ===== sync_escape_package_sell_price =====
-- overload: sync_escape_package_sell_price()
CREATE OR REPLACE FUNCTION public.sync_escape_package_sell_price()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_country text;
  v_total_base_cost integer;
  v_base_sell_price integer;
BEGIN
  SELECT origin_country_code INTO v_country FROM public.flight_blocks WHERE id = NEW.flight_block_id;
  IF v_country IS NULL THEN
    RAISE EXCEPTION 'sync_escape_package_sell_price: flight_block % has no origin_country_code', NEW.flight_block_id;
  END IF;

  v_total_base_cost := COALESCE(NEW.flight_cost_per_person_cents, 0)
                      + COALESCE(NEW.lodging_cost_per_person_cents, 0)
                      + COALESCE(NEW.driver_origin_cost_cents, 0)
                      + COALESCE(NEW.driver_destination_cost_cents, 0);

  v_base_sell_price := public.calculate_escape_sell_price(v_total_base_cost, v_country, false);

  NEW.price_per_person_cents := ROUND(v_base_sell_price * (1 + COALESCE(NEW.demand_markup_bps, 0) / 10000.0));
  NEW.platform_margin_cents := NEW.price_per_person_cents - v_total_base_cost;

  RETURN NEW;
END;
$function$;


-- ===== verify_safe_zone_location =====
-- overload: verify_safe_zone_location(p_zone_id uuid, p_geocoded_address text, p_geocoded_lat double precision, p_geocoded_lng double precision, p_document_id uuid, p_distance_meters double precision)
CREATE OR REPLACE FUNCTION public.verify_safe_zone_location(p_zone_id uuid, p_geocoded_address text, p_geocoded_lat double precision, p_geocoded_lng double precision, p_document_id uuid, p_distance_meters double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_user_id uuid;
    v_doc_address text;
    v_doc_status text;
    v_is_verified boolean;
    v_message text;
BEGIN
    -- Get the zone owner
    SELECT user_id INTO v_user_id
    FROM public.safe_zones
    WHERE id = p_zone_id;

    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Zone not found');
    END IF;

    -- Get the document
    SELECT verified_address, status INTO v_doc_address, v_doc_status
    FROM public.user_documents
    WHERE id = p_document_id AND user_id = v_user_id;

    IF v_doc_address IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Document not found or no verified address');
    END IF;

    IF v_doc_status != 'verified' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Document not yet verified');
    END IF;

    -- Check distance threshold (100m default)
    IF p_distance_meters IS NOT NULL AND p_distance_meters > 100 THEN
        v_is_verified := false;
        v_message := 'Zone location is ' || ROUND(p_distance_meters)::text || 'm from verified address (max 100m)';
    ELSE
        v_is_verified := true;
        v_message := 'Zone location matches verified address';
    END IF;

    -- Update zone verification status
    UPDATE public.safe_zones
    SET verification_status = CASE WHEN v_is_verified THEN 'verified' ELSE 'rejected' END,
        geocoded_address = p_geocoded_address,
        verified_document_id = p_document_id
    WHERE id = p_zone_id;

    -- If verified, update the zone's location to the geocoded pin for accuracy
    IF v_is_verified THEN
        UPDATE public.safe_zones
        SET location = ST_SetSRID(ST_MakePoint(p_geocoded_lng, p_geocoded_lat), 4326)::geography
        WHERE id = p_zone_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'verified', v_is_verified,
        'message', v_message,
        'distance_meters', p_distance_meters
    );
END;
$function$;


-- ===== waitlist_guard_public_insert =====
-- overload: waitlist_guard_public_insert()
CREATE OR REPLACE FUNCTION public.waitlist_guard_public_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_ip_hourly_limit   constant int := 5;   -- successful submissions per client IP per hour
  c_phone_daily_limit constant int := 3;   -- successful submissions per phone per 24h (all roles)
  v_api_role   text := coalesce(nullif(current_setting('role', true), ''), 'none');
  v_headers    jsonb;
  v_ip_text    text;
  v_ip         inet;
  v_phone      text;
  v_role_label text;
  v_expected   text;
  v_count      int;
begin
  -- Only public API traffic is policed. service_role (edge functions, admin
  -- tooling) and direct database sessions pass through unchanged. No existing
  -- SECURITY DEFINER RPC inserts into waitlist (checked 2026-09-11); if one is
  -- added and called by anon/authenticated, it WILL be policed by this trigger.
  if v_api_role not in ('anon', 'authenticated') then
    return new;
  end if;

  -- ---- Sanitise: strip control characters, trim, collapse whitespace ----
  new.full_name   := btrim(regexp_replace(regexp_replace(coalesce(new.full_name, ''), '[[:cntrl:]]', '', 'g'), '\s+', ' ', 'g'));
  new.phone       := nullif(btrim(regexp_replace(coalesce(new.phone, ''), '[[:cntrl:]]', '', 'g')), '');
  new.community   := nullif(btrim(regexp_replace(regexp_replace(coalesce(new.community, ''), '[[:cntrl:]]', '', 'g'), '\s+', ' ', 'g')), '');
  new.source      := btrim(regexp_replace(coalesce(new.source, ''), '[[:cntrl:]]', '', 'g'));
  new.user_type   := btrim(regexp_replace(coalesce(new.user_type, ''), '[[:cntrl:]]', '', 'g'));
  new.email       := nullif(btrim(regexp_replace(coalesce(new.email, ''), '[[:cntrl:]]', '', 'g')), '');
  new.referred_by := nullif(btrim(regexp_replace(coalesce(new.referred_by, ''), '[[:cntrl:]]', '', 'g')), '');

  -- ---- Name ----
  if length(new.full_name) < 2
     or length(new.full_name) > 80
     or new.full_name !~ '[[:alpha:]]'
     or new.full_name ~* '(https?:|www\.|[<>{}])' then
    raise exception 'WAITLIST_INVALID_NAME'
      using errcode = 'P0001',
            hint = 'Please enter your name (2 to 80 characters).';
  end if;

  -- ---- Phone (Trinidad & Tobago) ----
  v_phone := public.waitlist_normalize_tt_phone(new.phone);
  if v_phone is null then
    raise exception 'WAITLIST_INVALID_PHONE'
      using errcode = 'P0001',
            hint = 'Please enter a Trinidad and Tobago WhatsApp number, for example 868-555-1234 or 555-1234.';
  end if;

  -- ---- Role: exactly the site's options and its ROLE_TO_TYPE mapping ----
  if new.source !~ '^g868:' then
    raise exception 'WAITLIST_INVALID_ROLE'
      using errcode = 'P0001',
            hint = 'Please choose how you are joining.';
  end if;
  v_role_label := substr(new.source, 6);
  v_expected := case v_role_label
    when 'Rider'                then 'ride'
    when 'Driver'               then 'drive'
    when 'G-Partner (merchant)' then 'sell'
    when 'G-Lead (territory)'   then 'drive'
    when 'unspecified'          then 'ride'
    else null
  end;
  if v_expected is null or new.user_type is distinct from v_expected then
    raise exception 'WAITLIST_INVALID_ROLE'
      using errcode = 'P0001',
            hint = 'Please choose how you are joining.';
  end if;

  -- ---- Community ----
  if new.community is not null and length(new.community) > 80 then
    raise exception 'WAITLIST_INVALID_COMMUNITY'
      using errcode = 'P0001',
            hint = 'Please choose your community from the list.';
  end if;

  -- ---- Fields the site does not send: allowed only if sane ----
  if new.email is not null
     and (length(new.email) > 254 or new.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'WAITLIST_INVALID_FIELD'
      using errcode = 'P0001',
            hint = 'Some of the details sent were not accepted.';
  end if;
  if new.referred_by is not null and length(new.referred_by) > 64 then
    raise exception 'WAITLIST_INVALID_FIELD'
      using errcode = 'P0001',
            hint = 'Some of the details sent were not accepted.';
  end if;
  new.details := coalesce(new.details, '{}'::jsonb);
  if jsonb_typeof(new.details) <> 'object' or pg_column_size(new.details) > 2048 then
    raise exception 'WAITLIST_INVALID_FIELD'
      using errcode = 'P0001',
            hint = 'Some of the details sent were not accepted.';
  end if;

  -- ---- Server-owned columns: never client-controlled ----
  -- (status='approved' from the public API would bypass the admin approval
  -- gate that claim_waitlist_details() pre-fill relies on.)
  new.id                    := gen_random_uuid();
  new.status                := 'pending';
  new.created_at            := now();
  new.contacted_at          := null;
  new.contacted_by          := null;
  new.approved_at           := null;
  new.approved_by           := null;
  new.assigned_commander_id := null;

  -- ---- Client IP from PostgREST request headers ----
  -- cf-connecting-ip is preferred when present (set by the edge proxy, not the
  -- client); otherwise the first X-Forwarded-For address. Unparseable or absent
  -- -> NULL, which falls back to phone-based limiting only (never fail open to
  -- unlimited, never block everyone).
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  v_ip_text := coalesce(
    nullif(btrim(v_headers ->> 'cf-connecting-ip'), ''),
    nullif(btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), '')
  );
  if v_ip_text is not null then
    begin
      v_ip := v_ip_text::inet;
    exception when others then
      v_ip := null;
    end;
  end if;

  -- Serialise concurrent submissions for the same IP / phone so the counts
  -- below cannot be raced. Lock order is always IP then phone.
  if v_ip is not null then
    perform pg_advisory_xact_lock(hashtextextended('waitlist_ip:' || host(v_ip), 0));
  end if;
  perform pg_advisory_xact_lock(hashtextextended('waitlist_phone:' || v_phone, 0));

  -- ---- Rate limits ----
  if v_ip is not null then
    select count(*) into v_count
      from public.waitlist_submission_log l
     where l.client_ip = v_ip
       and l.created_at > now() - interval '1 hour';
    if v_count >= c_ip_hourly_limit then
      raise exception 'WAITLIST_RATE_LIMITED'
        using errcode = 'PT429',
              hint = 'Too many sign-ups from this connection. Please try again in an hour.';
    end if;
  end if;

  select count(*) into v_count
    from public.waitlist_submission_log l
   where l.phone_norm = v_phone
     and l.created_at > now() - interval '24 hours';
  if v_count >= c_phone_daily_limit then
    raise exception 'WAITLIST_RATE_LIMITED'
      using errcode = 'PT429',
            hint = 'Too many sign-ups for this number today. Please try again tomorrow.';
  end if;

  -- ---- Duplicate: same normalised phone + same G role within 24h ----
  if exists (
    select 1
      from public.waitlist w
     where w.created_at > now() - interval '24 hours'
       and w.source = new.source
       and public.waitlist_normalize_tt_phone(w.phone) = v_phone
  ) then
    raise exception 'WAITLIST_DUPLICATE'
      using errcode = 'PT409',
            hint = 'You are already on the list for this role. We will reach you on WhatsApp.';
  end if;

  -- ---- Record the accepted submission; prune old log rows ----
  insert into public.waitlist_submission_log (client_ip, phone_norm, waitlist_id)
  values (v_ip, v_phone, new.id);

  delete from public.waitlist_submission_log
   where created_at < now() - interval '48 hours';

  return new;
end;
$function$;


-- ===== waitlist_normalize_tt_phone =====
-- overload: waitlist_normalize_tt_phone(p_phone text)
CREATE OR REPLACE FUNCTION public.waitlist_normalize_tt_phone(p_phone text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_raw    text := btrim(coalesce(p_phone, ''));
  v_digits text;
begin
  if v_raw !~ '^\+?[0-9 ().-]{7,20}$' then
    return null;
  end if;

  v_digits := regexp_replace(v_raw, '[^0-9]', '', 'g');

  if length(v_digits) = 11 and left(v_digits, 4) = '1868' then
    v_digits := right(v_digits, 7);
  elsif length(v_digits) = 10 and left(v_digits, 3) = '868' then
    v_digits := right(v_digits, 7);
  elsif length(v_digits) <> 7 then
    return null;
  end if;

  -- T&T subscriber numbers never start with 0 or 1.
  if left(v_digits, 1) in ('0', '1') then
    return null;
  end if;

  return v_digits;
end;
$function$;
