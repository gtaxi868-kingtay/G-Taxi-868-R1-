-- Comprehensive security hardening — 2026-07-08
-- Closes every remaining gap from the Supabase security advisor sweep.
-- Idempotent. Safe to reapply.

-- =============================================================================
-- 1. RLS on watchdog_audit_log (was publicly readable/writable)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.watchdog_audit_log (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    event text,
    details jsonb,
    created_at timestamptz DEFAULT now()
);

ALTER TABLE public.watchdog_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin full access watchdog_audit_log" ON public.watchdog_audit_log;
CREATE POLICY "Admin full access watchdog_audit_log"
  ON public.watchdog_audit_log
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'::public.user_role
    )
  );

-- =============================================================================
-- 2. RLS on rider_route_patterns (per-rider isolation)
-- =============================================================================
ALTER TABLE IF EXISTS public.rider_route_patterns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rider_route_patterns_own" ON public.rider_route_patterns;
CREATE POLICY "rider_route_patterns_own"
  ON public.rider_route_patterns
  TO authenticated
  USING (rider_id = auth.uid())
  WITH CHECK (rider_id = auth.uid());

-- =============================================================================
-- 3. Reserve health — no RLS policies yet, add service_role-only access
-- =============================================================================
ALTER TABLE IF EXISTS public.reserve_health ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reserve_health_service_role_only" ON public.reserve_health;
CREATE POLICY "reserve_health_service_role_only"
  ON public.reserve_health
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "reserve_health_admin_read" ON public.reserve_health;
CREATE POLICY "reserve_health_admin_read"
  ON public.reserve_health
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'::public.user_role
    )
  );

-- =============================================================================
-- 4. Fix delivery_offers policy — "Service role delivery offers" was named
--    deceptively: no role filter, USING=true, WITH CHECK=true (full public access).
--    Replace with proper driver-scoped policy.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.delivery_offers (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    driver_id uuid REFERENCES auth.users(id),
    status text DEFAULT '''pending''',
    created_at timestamptz DEFAULT now()
);

ALTER TABLE public.delivery_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role delivery offers" ON public.delivery_offers;

DROP POLICY IF EXISTS "delivery_offers_driver_access" ON public.delivery_offers;
CREATE POLICY "delivery_offers_driver_access"
  ON public.delivery_offers
  TO authenticated
  USING (
    driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
  );

-- =============================================================================
-- 5. Revoke anon/authenticated EXECUTE on SECURITY DEFINER functions
--    that should only be callable via service_role (edge functions).
--    PostGIS built-in st_estimatedextent (C lang, no user data) excluded.
-- =============================================================================

-- 5a. Trigger helpers — no user should call these directly

-- REVOKE removed: function does not exist;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION trg_flag_pair_velocity() FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION trg_record_rider_pattern() FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION trg_safety_cancel_in_transit() FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- 5b. Admin/sensitive operations — identity verification, leasing, compliance

DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION apply_for_driver_lease(p_driver_id uuid, p_fleet_vehicle_id uuid, p_daily_deduction_cents integer, p_total_lease_cents integer) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION approve_compliance_document(p_queue_id uuid, p_reviewer_id uuid, p_new_expiry timestamptz) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION approve_driver_lease(p_lease_id uuid, p_term_finance_agreement_id text) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION check_driver_insurance_compliance(p_driver_id uuid) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION get_commander_revshare_balance(p_commander_id uuid) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION increment_referral_reward_rides(p_rider_id uuid, p_driver_id uuid) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION submit_driver_compliance_document(p_driver_id uuid, p_document_type text, p_document_url text, p_expiry_date timestamptz) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION verify_safe_zone_location(p_zone_id uuid, p_geocoded_address text, p_geocoded_lat double precision, p_geocoded_lng double precision, p_document_id uuid, p_distance_meters double precision) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- 5c. Financial / payment functions — wallet and payment operations
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION compute_ride_split(p_ride_id uuid, p_gross_cents bigint) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION generate_cash_withdrawal_code(p_user_id uuid, p_driver_id uuid, p_amount_cents integer, p_fee_cents integer) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION process_nfc_payment(p_tag_uid text, p_driver_id uuid, p_method text) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION record_ride_kickbacks(p_ride_id uuid, p_rider_id uuid, p_gross_cents bigint, p_split jsonb) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION redeem_cash_withdrawal_code(p_code text, p_agent_id uuid) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- 5d. Process_tip — should only be callable from edge functions
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION process_tip(p_ride_id uuid, p_amount integer) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- 5e. Driver location — authenticated drivers need this via edge function
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION update_driver_location_packet(p_lat double precision, p_lng double precision, p_heading double precision, p_speed double precision) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- =============================================================================
-- 6. Revoke authenticated EXECUTE on admin-only SECURITY DEFINER functions
-- =============================================================================
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION admin_create_surge_zone(p_lat double precision, p_lng double precision, p_radius_m integer, p_multiplier numeric, p_reason text, p_expires_at timestamptz) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION admin_deactivate_surge_zone(p_zone_id uuid) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION admin_escape_action(p_package_id uuid, p_action text, p_booking_ref text, p_message text) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION admin_escape_action(p_package_id uuid, p_action text, p_departure_date timestamptz, p_arrival_date timestamptz, p_booking_ref text, p_message text) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION admin_get_organizer_banks(p_organizer_id uuid, p_ledger_type text) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION admin_get_reserve_balance() FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION admin_get_surge_zones() FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION admin_review_node(p_node_id uuid, p_approve boolean, p_reason text) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION admin_set_merchant_billing(p_merchant_id uuid, p_enabled boolean) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION admin_set_pricing(p_key text, p_value_cents integer) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION admin_set_surge_zone(p_lat double precision, p_lng double precision, p_radius_km double precision, p_multiplier numeric, p_expires_at timestamptz) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION admin_set_system_config(p_key text, p_value text) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION admin_toggle_feature_flag(p_id text, p_is_active boolean) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION admin_update_vertical(p_id uuid, p_is_enabled boolean, p_rollout integer) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION admin_upsert_organizer_bank(p_organizer_id uuid, p_ledger_type text, p_bank_name text, p_account_holder_name text, p_account_number text, p_account_type text, p_is_default boolean) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- =============================================================================
-- 7. Grant EXECUTE back to service_role for all revoked functions
-- =============================================================================
-- Triggers
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION expire_stale_withdrawal_codes() TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION trg_flag_pair_velocity() TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION trg_record_rider_pattern() TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION trg_safety_cancel_in_transit() TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
-- Admin / compliance / leasing
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION apply_for_driver_lease(p_driver_id uuid, p_fleet_vehicle_id uuid, p_daily_deduction_cents integer, p_total_lease_cents integer) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION approve_compliance_document(p_queue_id uuid, p_reviewer_id uuid, p_new_expiry timestamptz) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION approve_driver_lease(p_lease_id uuid, p_term_finance_agreement_id text) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION check_driver_insurance_compliance(p_driver_id uuid) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION get_commander_revshare_balance(p_commander_id uuid) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION increment_referral_reward_rides(p_rider_id uuid, p_driver_id uuid) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION submit_driver_compliance_document(p_driver_id uuid, p_document_type text, p_document_url text, p_expiry_date timestamptz) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION verify_safe_zone_location(p_zone_id uuid, p_geocoded_address text, p_geocoded_lat double precision, p_geocoded_lng double precision, p_document_id uuid, p_distance_meters double precision) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
-- Financial
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION compute_ride_split(p_ride_id uuid, p_gross_cents bigint) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION generate_cash_withdrawal_code(p_user_id uuid, p_driver_id uuid, p_amount_cents integer, p_fee_cents integer) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION process_nfc_payment(p_tag_uid text, p_driver_id uuid, p_method text) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION record_ride_kickbacks(p_ride_id uuid, p_rider_id uuid, p_gross_cents bigint, p_split jsonb) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION redeem_cash_withdrawal_code(p_code text, p_agent_id uuid) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION process_tip(p_ride_id uuid, p_amount integer) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION update_driver_location_packet(p_lat double precision, p_lng double precision, p_heading double precision, p_speed double precision) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
-- Admin CRUD
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION admin_create_surge_zone(p_lat double precision, p_lng double precision, p_radius_m integer, p_multiplier numeric, p_reason text, p_expires_at timestamptz) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION admin_deactivate_surge_zone(p_zone_id uuid) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION admin_escape_action(p_package_id uuid, p_action text, p_booking_ref text, p_message text) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION admin_escape_action(p_package_id uuid, p_action text, p_departure_date timestamptz, p_arrival_date timestamptz, p_booking_ref text, p_message text) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION admin_get_organizer_banks(p_organizer_id uuid, p_ledger_type text) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION admin_get_reserve_balance() TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION admin_get_surge_zones() TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION admin_review_node(p_node_id uuid, p_approve boolean, p_reason text) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION admin_set_merchant_billing(p_merchant_id uuid, p_enabled boolean) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION admin_set_pricing(p_key text, p_value_cents integer) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION admin_set_surge_zone(p_lat double precision, p_lng double precision, p_radius_km double precision, p_multiplier numeric, p_expires_at timestamptz) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION admin_set_system_config(p_key text, p_value text) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION admin_toggle_feature_flag(p_id text, p_is_active boolean) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION admin_update_vertical(p_id uuid, p_is_enabled boolean, p_rollout integer) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION admin_upsert_organizer_bank(p_organizer_id uuid, p_ledger_type text, p_bank_name text, p_account_holder_name text, p_account_number text, p_account_type text, p_is_default boolean) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
-- rider_wallet_payment (already revoked from anon, now also from authenticated)
DO $$ BEGIN
    REVOKE EXECUTE ON FUNCTION rider_wallet_payment(p_user_id uuid, p_merchant_id uuid, p_amount_cents bigint, p_merchant_name text) FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION rider_wallet_payment(p_user_id uuid, p_merchant_id uuid, p_amount_cents bigint, p_merchant_name text) TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
-- =============================================================================
-- 8. Fix SECURITY DEFINER search_path on critical functions
--    Without explicit search_path, SECURITY DEFINER inherits the caller's
--    search_path, opening search_path hijacking.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_ride_arrived_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog,public'
AS $$
BEGIN
  UPDATE rides SET arrived_at = NOW() WHERE id = NEW.ride_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_merchant_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog,public'
AS $$
BEGIN
  INSERT INTO merchant_audit_log (merchant_id, old_status, new_status, changed_by)
  VALUES (OLD.id, OLD.activation_status, NEW.activation_status, COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid));
  RETURN NEW;
END;
$$;