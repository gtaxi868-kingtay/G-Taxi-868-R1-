-- 20261029140000_lease_chain_repair.sql
-- WS2 of the Day-One machine repairs (2026-10-29): repair the bank/lease
-- chain joints named in g868-dayone-readiness-29oct2026.md §3.
--
-- (a) DEDUCTION: complete_ride calls deduct_loan_installment(driver, ride)
--     on EVERY completed ride; the function DID NOT EXIST (the call is
--     non-fatal, so rides completed while the deduction silently never
--     happened). This migration builds it against the EXISTING
--     driver_leases schema (the Term Finance book — daily_deduction_cents,
--     paid_to_date_cents, remaining_balance_cents). The fleet_leases book
--     keeps its own deduct_lease_installment_for_ride(); complete_ride's
--     broken call to THAT function (wrong args, wrong result column) is
--     fixed in the edge-function source in the same branch.
-- (b) ONE GATE: apply_for_driver_lease's 500-rides + 4.8-rating standard
--     is canonical. refresh_driver_lease_eligibility (90 active days) is
--     rewritten to it below. The third gate — G Garage's 14 earning days
--     (supabase/functions/g_garage/index.ts MIN_EARNING_DAYS_REQUIRED) —
--     is a DIFFERENT product (vehicle-sourcing requests decided by an
--     admin into fleet_leases, with contribution bounds computed from
--     real earnings), not a lease-underwriting standard, so it is left
--     as-is and documented here rather than conflated.
-- (c) CONSENT -> APPLICATION: apply_for_driver_lease required a fleet
--     vehicle to exist at application time, so the consent flow's own
--     submission shape (fleet_vehicle_id NULL — no vehicle is assigned
--     yet) was rejected 100% of the time. Vehicle is now optional at
--     application; assignment happens at approval.
-- (d) KYC: driver_leases gains national_id / date_of_birth /
--     residential_address, captured by apply_for_driver_lease's new
--     optional parameters, so a bank pack can be produced from the
--     application row. (profiles.national_id_hash is NOT written: no
--     hash scheme exists anywhere in the codebase to match, and the
--     bank needs the number itself from the application.)
--
-- Generated from the LIVE definitions of apply_for_driver_lease and
-- refresh_driver_lease_eligibility (pg_get_functiondef, 2026-10-29) with
-- asserted surgical replacements only. Smoke-tested in a rolled-back
-- transaction against the live DB before commit; NOT applied live by
-- this branch.

-- (d) KYC columns on the application row.
ALTER TABLE public.driver_leases
  ADD COLUMN IF NOT EXISTS national_id text,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS residential_address text;

COMMENT ON COLUMN public.driver_leases.national_id IS
  'KYC captured at lease application (WS2, 2026-10-29) for the bank/Term Finance pack.';
COMMENT ON COLUMN public.driver_leases.date_of_birth IS
  'KYC captured at lease application (WS2, 2026-10-29).';
COMMENT ON COLUMN public.driver_leases.residential_address IS
  'KYC captured at lease application (WS2, 2026-10-29).';

-- =====================================================================
-- (a) deduct_loan_installment: the missing deduction function.
-- =====================================================================

-- =====================================================================
-- (a) deduct_loan_installment — the missing deduction, built against
-- driver_leases. Signature matches complete_ride's existing call
-- (supabase/functions/complete_ride/index.ts, "Loan installment
-- deduction" block): rpc('deduct_loan_installment', {p_driver_id,
-- p_ride_id}). The caller treats failure as non-fatal and ignores the
-- payload; every outcome is reported in the returned jsonb.
--
-- Terms respected (the lease row's own columns):
--   * only status='active' leases with auto_deduct_enabled;
--   * per-day take never exceeds daily_deduction_cents (today's prior
--     deductions for this lease count against it);
--   * per-ride take never exceeds that ride's driver_payout_cents;
--   * never takes the driver's wallet below TT$0 (capped at the live
--     wallet balance — sum of wallet_transactions, the codebase's
--     balance definition);
--   * never exceeds the remaining balance (the generated column
--     total_lease_cents - paid_to_date_cents);
--   * idempotent per ride via the wallet ledger reference_id
--     'driver_lease_deduction:<lease_id>:<ride_id>' under the lease
--     row's FOR UPDATE lock;
--   * the deduction is a wallet_transactions row (transaction_type
--     'lease_deduction') — lease_payments.lease_id references
--     fleet_leases and cannot record driver_leases deductions;
--   * paid_to_date_cents advances on the lease row in the same
--     transaction (remaining_balance_cents is a GENERATED column,
--     total - paid, and follows); a lease paid to zero flips to
--     status 'completed'.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.deduct_loan_installment(p_driver_id uuid, p_ride_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_lease     record;
  v_ride      record;
  v_user_id   uuid;
  v_ref       text;
  v_existing  integer;
  v_today     integer;
  v_room      integer;
  v_remaining integer;
  v_balance   integer;
  v_amount    integer;
BEGIN
  SELECT * INTO v_lease
  FROM public.driver_leases
  WHERE driver_id = p_driver_id
    AND status = 'active'
    AND COALESCE(auto_deduct_enabled, true)
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'deducted', false,
      'reason', 'no_active_lease', 'deduction_cents', 0);
  END IF;

  v_ref := 'driver_lease_deduction:' || v_lease.id::text || ':' || p_ride_id::text;

  SELECT ABS(amount) INTO v_existing
  FROM public.wallet_transactions
  WHERE reference_id = v_ref
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'deducted', false,
      'reason', 'already_deducted', 'deduction_cents', v_existing,
      'lease_id', v_lease.id);
  END IF;

  SELECT * INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id AND driver_id = p_driver_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'deducted', false,
      'reason', 'ride_not_found_for_driver', 'deduction_cents', 0,
      'lease_id', v_lease.id);
  END IF;

  IF v_ride.driver_payout_cents IS NULL THEN
    RETURN jsonb_build_object('success', true, 'deducted', false,
      'reason', 'ride_earnings_unrecorded', 'deduction_cents', 0,
      'lease_id', v_lease.id);
  END IF;

  SELECT user_id INTO v_user_id FROM public.drivers WHERE id = p_driver_id;

  -- remaining_balance_cents is a GENERATED column
  -- (total_lease_cents - paid_to_date_cents): always derived, never set.
  IF v_lease.total_lease_cents IS NULL THEN
    v_remaining := NULL;
  ELSE
    v_remaining := v_lease.total_lease_cents - COALESCE(v_lease.paid_to_date_cents, 0);
  END IF;
  IF v_remaining IS NULL THEN
    RETURN jsonb_build_object('success', true, 'deducted', false,
      'reason', 'lease_total_unset', 'deduction_cents', 0,
      'lease_id', v_lease.id);
  END IF;
  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('success', true, 'deducted', false,
      'reason', 'lease_fully_paid', 'deduction_cents', 0,
      'lease_id', v_lease.id);
  END IF;

  SELECT COALESCE(SUM(ABS(amount)), 0)::integer INTO v_today
  FROM public.wallet_transactions
  WHERE reference_id LIKE 'driver_lease_deduction:' || v_lease.id::text || ':%'
    AND created_at >= date_trunc('day', now());

  v_room := COALESCE(v_lease.daily_deduction_cents, 0) - v_today;
  IF v_room <= 0 THEN
    RETURN jsonb_build_object('success', true, 'deducted', false,
      'reason', 'daily_target_reached', 'deduction_cents', 0,
      'lease_id', v_lease.id);
  END IF;

  SELECT COALESCE(SUM(amount), 0)::integer INTO v_balance
  FROM public.wallet_transactions
  WHERE user_id = v_user_id;

  v_amount := LEAST(v_remaining, v_room, v_ride.driver_payout_cents, v_balance);
  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('success', true, 'deducted', false,
      'reason', CASE WHEN v_balance <= 0 THEN 'insufficient_wallet_balance'
                     ELSE 'ride_payout_zero' END,
      'deduction_cents', 0, 'lease_id', v_lease.id);
  END IF;

  INSERT INTO public.wallet_transactions
    (user_id, amount, transaction_type, description, reference_id, status)
  VALUES
    (v_user_id, -v_amount, 'lease_deduction',
     'BYD lease installment deduction (driver_leases)', v_ref, 'completed');

  -- Only paid_to_date_cents advances; remaining_balance_cents is
  -- generated from (total - paid) and follows automatically.
  UPDATE public.driver_leases
  SET paid_to_date_cents = COALESCE(paid_to_date_cents, 0) + v_amount,
      status = CASE WHEN v_remaining - v_amount <= 0 THEN 'completed' ELSE status END,
      updated_at = now()
  WHERE id = v_lease.id;

  RETURN jsonb_build_object('success', true, 'deducted', true,
    'deduction_cents', v_amount, 'lease_id', v_lease.id,
    'remaining_balance_cents', v_remaining - v_amount);
END;
$function$;

REVOKE ALL ON FUNCTION public.deduct_loan_installment(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_loan_installment(uuid, uuid) TO service_role;

-- =====================================================================
-- (c)+(d) apply_for_driver_lease: vehicle optional at application;
-- KYC parameters captured onto the application row.
-- =====================================================================
DROP FUNCTION IF EXISTS public.apply_for_driver_lease(uuid, uuid, integer, integer);

CREATE OR REPLACE FUNCTION public.apply_for_driver_lease(p_driver_id uuid, p_fleet_vehicle_id uuid DEFAULT NULL, p_daily_deduction_cents integer DEFAULT 15000, p_total_lease_cents integer DEFAULT NULL::integer, p_national_id text DEFAULT NULL, p_date_of_birth date DEFAULT NULL, p_residential_address text DEFAULT NULL)
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

REVOKE ALL ON FUNCTION public.apply_for_driver_lease(uuid, uuid, integer, integer, text, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_for_driver_lease(uuid, uuid, integer, integer, text, date, text) TO service_role;

-- =====================================================================
-- (b) refresh_driver_lease_eligibility: defer to the canonical gate.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.refresh_driver_lease_eligibility(p_driver_id uuid)
 RETURNS TABLE(active_days_count integer, qualified boolean, newly_qualified boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_days          INTEGER;
  v_first         DATE;
  v_last          DATE;
  v_was_qualified BOOLEAN := false;
  v_completed_rides INTEGER;
  v_rating          NUMERIC;
  v_now_qualified BOOLEAN;
BEGIN
  SELECT
    COUNT(DISTINCT DATE(r.completed_at))::integer,
    MIN(DATE(r.completed_at)),
    MAX(DATE(r.completed_at))
  INTO v_days, v_first, v_last
  FROM public.rides r
  WHERE r.driver_id = p_driver_id
    AND r.status = 'completed'
    AND r.completed_at >= now() - INTERVAL '180 days';

  v_days          := COALESCE(v_days, 0);

  -- WS2 repair (2026-10-29): ONE eligibility gate. Qualification for the
  -- Term Finance driver lease is the apply_for_driver_lease standard --
  -- 500+ completed rides (all time) AND rating >= 4.8. This function
  -- previously qualified drivers at 90 active days, contradicting the
  -- application RPC: complete_ride pushed "you qualify" and
  -- driver_lease_status reported qualified while apply_for_driver_lease
  -- refused the same driver. Active-day stats are still recorded above
  -- (progress/history); they no longer decide qualification.
  SELECT COUNT(*)::integer INTO v_completed_rides
  FROM public.rides r
  WHERE r.driver_id = p_driver_id AND r.status = 'completed';

  SELECT d.rating INTO v_rating FROM public.drivers d WHERE d.id = p_driver_id;

  v_now_qualified := COALESCE(v_completed_rides, 0) >= 500 AND COALESCE(v_rating, 0) >= 4.8;

  -- Table-qualified on purpose: unqualified, 'qualified' is ambiguous
  -- with this function's own OUT column of the same name (42702) -- with
  -- the plain reference every call raises, and both callers (complete_ride,
  -- driver_lease_status) swallow errors, so the 90-day refresh has been
  -- silently failing. (WS2 repair, 2026-10-29.)
  SELECT e.qualified INTO v_was_qualified FROM public.driver_lease_eligibility e WHERE e.driver_id = p_driver_id;

  INSERT INTO public.driver_lease_eligibility
    (driver_id, active_days_count, first_active_date, last_active_date, qualified, qualified_at, updated_at)
  VALUES (p_driver_id, v_days, v_first, v_last, v_now_qualified,
    CASE WHEN v_now_qualified AND NOT COALESCE(v_was_qualified, false) THEN now() ELSE NULL END, now())
  ON CONFLICT (driver_id) DO UPDATE SET
    active_days_count = v_days,
    first_active_date = COALESCE(v_first, driver_lease_eligibility.first_active_date),
    last_active_date  = v_last,
    qualified         = v_now_qualified,
    qualified_at      = CASE WHEN v_now_qualified AND NOT driver_lease_eligibility.qualified
      THEN now() ELSE driver_lease_eligibility.qualified_at END,
    updated_at        = now();

  RETURN QUERY SELECT v_days, v_now_qualified, (v_now_qualified AND NOT COALESCE(v_was_qualified, false));
END;
$function$;
