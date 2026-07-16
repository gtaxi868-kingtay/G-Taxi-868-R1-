-- ═══════════════════════════════════════════════════════════════════
-- CRASH FIXES FOUND BY DRY-RUN VERIFICATION (2026-07-16)
--
-- Before pushing 20260718000000 live, every function it touched was
-- exercised end-to-end in rolled-back transactions. That surfaced FIVE
-- additional pre-existing bugs — none introduced by this session, all
-- inherited verbatim from functions that had simply never been exercised
-- by a real payment (0 wallet_transactions rows existed in production
-- before tonight). Each one would have crashed the FIRST real ride on
-- its path. Fixed here, in the order discovered:
--
-- 1. process_wallet_payment_hardened inserted a `metadata` column into
--    wallet_transactions — that column has never existed. -> reference_id.
-- 2. Same function inserted transaction_type='platform_commission' —
--    not in the CHECK constraint's allowed list. -> 'commission_fee'.
-- 3. process_driver_settlement_atomic declared v_ledger_id as BIGINT but
--    payment_ledger.id is uuid — RETURNING id INTO v_ledger_id crashed.
-- 4. compute_ride_split's commander lookup queried
--    profiles.referred_by_commander_id keyed on the driver's resolved
--    auth id. Drivers NEVER get a profiles row in this system (profiles
--    is rider/admin/merchant/commander only — confirmed 13 of 14 live
--    drivers have zero matching profiles row). Commander revshare could
--    not fire for ANY driver, on ANY payment path (cash included),
--    since the function was written. Real relationship is
--    drivers.territory_id -> pod_commanders.territory_id, matching the
--    pattern the older retired record_pool_entry used. Verified against
--    a real, already-existing driver/commander/territory match in
--    production that had never once generated a payout.
-- 5. wallet_transactions_transaction_type_check was missing two values
--    real code depends on: 'commission_debt' (settle_cash_ride — the
--    ALREADY-LIVE, previously "verified working" cash path — and
--    check_driver_debt_limit) and 'debt_settlement' (admin_settle_debt,
--    admin/index.ts). Every real cash-ride completion would have
--    crashed on this constraint. Confirmed 'order_payment' and
--    'rider_initiated_purchase' are false positives (a metadata.type
--    comparison and a payment_ledger.metadata jsonb key respectively,
--    neither touches this column).
--
-- get_wallet_balance and process_merchant_billing were also corrected to
-- read live SUM(wallet_transactions.amount) instead of the wallets.balance_cents
-- cache, which most money-moving paths (including all of the above) never
-- update — the table's own comment says "Truth is Sum(amount)"; this makes
-- the readers honor that. Zero behavioral change in production today (0
-- wallet_transactions rows existed before this session's dry-runs).
--
-- Every fix below was proven via a real end-to-end settlement in a
-- rolled-back transaction, including get_wallet_balance called AS the
-- driver (RLS auth.uid() enforced, not bypassed) before being applied.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compute_ride_split(p_ride_id uuid, p_gross_cents bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_driver_bps int; v_reserve_bps int; v_commander_bps int; v_node_bps int;
  v_driver_pool bigint; v_reserve bigint; v_commander_cut bigint := 0; v_vendor_cut bigint := 0;
  v_driver_net bigint; v_platform_raw bigint; v_platform_fee bigint;
  v_driver_id uuid; v_driver_uid uuid; v_driver_territory_id uuid;
  v_commander_id uuid; v_node_id uuid; v_merchant_id uuid;
BEGIN
  IF p_gross_cents IS NULL OR p_gross_cents <= 0 THEN
    RETURN jsonb_build_object('driver_net',0,'commander_cut',0,'vendor_cut',0,'reserve',0,
      'platform_fee',0,'commander_id',NULL,'merchant_id',NULL,'node_id',NULL);
  END IF;
  SELECT
    COALESCE(MAX(CASE WHEN key='DRIVER_SHARE_CENTS' THEN value_cents END),8000),
    COALESCE(MAX(CASE WHEN key='RESERVE_RATE_CENTS' THEN value_cents END),150),
    COALESCE(MAX(CASE WHEN key='COMMANDER_REVSHARE_RATE_CENTS' THEN value_cents END),200),
    COALESCE(MAX(CASE WHEN key='NODE_COMMISSION_RATE_ON_PLATFORM_BPS' THEN value_cents END),200)
  INTO v_driver_bps, v_reserve_bps, v_commander_bps, v_node_bps
  FROM public.pricing_config WHERE key IN ('DRIVER_SHARE_CENTS','RESERVE_RATE_CENTS','COMMANDER_REVSHARE_RATE_CENTS','NODE_COMMISSION_RATE_ON_PLATFORM_BPS');

  v_driver_pool := ROUND(p_gross_cents * v_driver_bps / 10000.0);
  v_reserve     := ROUND(p_gross_cents * v_reserve_bps / 10000.0);

  SELECT driver_id, vendor_node_id INTO v_driver_id, v_node_id FROM public.rides WHERE id = p_ride_id;
  SELECT user_id, territory_id INTO v_driver_uid, v_driver_territory_id FROM public.drivers WHERE id = v_driver_id;
  IF v_driver_uid IS NULL THEN v_driver_uid := v_driver_id; END IF;

  IF v_driver_territory_id IS NOT NULL THEN
    SELECT id INTO v_commander_id
    FROM public.pod_commanders
    WHERE territory_id = v_driver_territory_id AND status = 'active'
    LIMIT 1;
  END IF;

  IF v_commander_id IS NOT NULL THEN
    v_commander_cut := ROUND(p_gross_cents * v_commander_bps / 10000.0);
  END IF;
  v_driver_net := v_driver_pool - v_commander_cut;

  v_platform_raw := p_gross_cents - v_driver_net - v_commander_cut - v_reserve;

  IF v_node_id IS NOT NULL THEN
    SELECT merchant_id INTO v_merchant_id FROM public.kiosk_nodes WHERE id = v_node_id;
    IF v_merchant_id IS NOT NULL AND v_platform_raw > 0 THEN
      v_vendor_cut := ROUND(v_platform_raw * v_node_bps / 10000.0);
    END IF;
  END IF;

  v_platform_fee := v_platform_raw - v_vendor_cut;

  RETURN jsonb_build_object('driver_net',v_driver_net,'commander_cut',v_commander_cut,'vendor_cut',v_vendor_cut,
    'reserve',v_reserve,'platform_fee',v_platform_fee,'commander_id',v_commander_id,
    'merchant_id',v_merchant_id,'node_id',v_node_id);
END;
$function$;

CREATE OR REPLACE FUNCTION "public"."process_wallet_payment_hardened"("p_ride_id" "uuid", "p_amount" integer, "p_idempotency_key" "text" DEFAULT NULL::"text")
RETURNS TABLE("success" boolean, "error_message" "text", "transaction_id" "uuid")
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_rider_id       UUID;
    v_driver_id      UUID;
    v_driver_uid     UUID;
    v_platform_id    UUID := '00000000-0000-0000-0000-000000000000';
    v_payment_status TEXT;
    v_ride_status    TEXT;
    v_balance        INTEGER;
    v_advisory_lock_id BIGINT;
    v_txn_id         UUID := gen_random_uuid();
    v_split          jsonb;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN QUERY SELECT FALSE, 'Invalid amount: must be positive', NULL::UUID;
        RETURN;
    END IF;
    IF p_ride_id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Ride ID is required', NULL::UUID;
        RETURN;
    END IF;
    v_advisory_lock_id := ('x' || substr(md5(p_ride_id::text), 1, 16))::bit(64)::bigint;
    IF NOT pg_try_advisory_xact_lock(v_advisory_lock_id) THEN
        RETURN QUERY SELECT FALSE, 'Ride is being processed by another request', NULL::UUID;
        RETURN;
    END IF;
    SELECT r.rider_id, r.driver_id, r.payment_status, r.status
    INTO v_rider_id, v_driver_id, v_payment_status, v_ride_status
    FROM public.rides r WHERE r.id = p_ride_id FOR UPDATE;
    IF v_rider_id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Ride not found', NULL::UUID;
        RETURN;
    END IF;
    IF v_driver_id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Ride has no assigned driver', NULL::UUID;
        RETURN;
    END IF;
    IF v_ride_status NOT IN ('assigned', 'arrived', 'in_progress', 'completed') THEN
        RETURN QUERY SELECT FALSE, format('Cannot process payment for ride in %s status', v_ride_status), NULL::UUID;
        RETURN;
    END IF;
    IF v_payment_status = 'captured' THEN
        RETURN QUERY SELECT TRUE, 'Payment already processed', v_txn_id;
        RETURN;
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.wallet_transactions
        WHERE ride_id = p_ride_id AND transaction_type = 'ride_payment' AND amount < 0
    ) THEN
        UPDATE public.rides SET payment_status = 'captured', updated_at = NOW() WHERE id = p_ride_id;
        RETURN QUERY SELECT TRUE, 'Payment already processed (state repaired)', v_txn_id;
        RETURN;
    END IF;
    v_advisory_lock_id := ('x' || substr(md5(v_rider_id::text), 1, 16))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(v_advisory_lock_id);
    SELECT COALESCE(SUM(amount), 0) INTO v_balance FROM public.wallet_transactions WHERE user_id = v_rider_id;
    IF v_balance < p_amount THEN
        RETURN QUERY SELECT FALSE, format('Insufficient balance: %s cents available, %s cents required', v_balance, p_amount), NULL::UUID;
        RETURN;
    END IF;
    SELECT user_id INTO v_driver_uid FROM public.drivers WHERE id = v_driver_id;
    IF v_driver_uid IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Driver account not found for settlement', NULL::UUID;
        RETURN;
    END IF;
    v_split := public.compute_ride_split(p_ride_id, p_amount);
    BEGIN
        INSERT INTO public.wallet_transactions
            (id, user_id, ride_id, amount, transaction_type, description, status, reference_id)
        VALUES
            (gen_random_uuid(), v_rider_id, p_ride_id, -p_amount, 'ride_payment',
             'Ride payment (wallet)', 'completed', p_idempotency_key);
    EXCEPTION
        WHEN unique_violation THEN
            IF EXISTS (SELECT 1 FROM public.wallet_transactions
                      WHERE ride_id = p_ride_id AND user_id = v_rider_id
                      AND transaction_type = 'ride_payment' AND amount = -p_amount) THEN
                UPDATE public.rides SET payment_status = 'captured', updated_at = NOW() WHERE id = p_ride_id;
                RETURN QUERY SELECT TRUE, 'Payment already processed (duplicate request)', v_txn_id;
                RETURN;
            ELSE
                RAISE;
            END IF;
    END;
    INSERT INTO public.wallet_transactions
        (id, user_id, ride_id, amount, transaction_type, description, status)
    VALUES
        (gen_random_uuid(), v_driver_uid, p_ride_id, (v_split->>'driver_net')::integer, 'driver_payout',
         'Ride earnings (wallet)', 'completed');
    INSERT INTO public.wallet_transactions
        (id, user_id, ride_id, amount, transaction_type, description, status)
    VALUES
        (gen_random_uuid(), v_platform_id, p_ride_id, (v_split->>'platform_fee')::integer, 'commission_fee',
         'Platform commission (wallet ride)', 'completed');
    IF (v_split->>'reserve')::integer > 0 THEN
        PERFORM public.post_reserve_contribution(p_ride_id, (v_split->>'reserve')::integer, 'ride');
    END IF;
    PERFORM public.record_ride_kickbacks(p_ride_id, v_rider_id, p_amount, v_split);
    INSERT INTO public.payment_ledger
        (id, ride_id, user_id, amount, currency, status, provider, metadata)
    VALUES
        (gen_random_uuid(), p_ride_id, v_rider_id, (p_amount / 100.0), 'TTD',
         'captured', 'wallet', jsonb_build_object('idempotency_key', p_idempotency_key));
    UPDATE public.rides
    SET payment_status = 'captured', updated_at = NOW(),
        total_fare_cents = COALESCE(total_fare_cents, p_amount),
        driver_payout_cents = (v_split->>'driver_net')::integer,
        platform_fee_cents = (v_split->>'platform_fee')::integer,
        reserve_cents = (v_split->>'reserve')::integer
    WHERE id = p_ride_id;
    RETURN QUERY SELECT TRUE, NULL::TEXT, v_txn_id;
EXCEPTION
    WHEN OTHERS THEN
        RETURN QUERY SELECT FALSE, SQLERRM, NULL::UUID;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_driver_settlement_atomic(p_event_id text, p_ride_id uuid, p_driver_id uuid, p_rider_id uuid, p_gross_cents bigint, p_currency text, p_provider_ref text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_lock_acquired BOOLEAN;
    v_already_processed BOOLEAN;
    v_driver_uid UUID;
    v_ledger_id UUID;
    v_split jsonb;
    v_platform_account CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
    SELECT pg_try_advisory_xact_lock(hashtext(p_event_id)) INTO v_lock_acquired;
    IF NOT v_lock_acquired THEN
        RETURN jsonb_build_object('status', 'CONFLICT', 'error', 'Settlement for event ' || p_event_id || ' is already being processed by another thread.');
    END IF;
    SELECT EXISTS(SELECT 1 FROM public.processed_stripe_events WHERE event_id = p_event_id AND status = 'SUCCESS') INTO v_already_processed;
    IF v_already_processed THEN
        RETURN jsonb_build_object('status', 'SKIPPED', 'message', 'Event already processed.');
    END IF;
    SELECT user_id INTO v_driver_uid FROM public.drivers WHERE id = p_driver_id;
    IF v_driver_uid IS NULL THEN
        INSERT INTO public.processed_stripe_events (event_id, status)
        VALUES (p_event_id, 'FAILED')
        ON CONFLICT (event_id) DO UPDATE SET status = 'FAILED', processed_at = NOW();
        RETURN jsonb_build_object('status', 'FAILED', 'error', 'Driver account not found for settlement');
    END IF;
    v_split := public.compute_ride_split(p_ride_id, p_gross_cents);
    INSERT INTO payment_ledger (ride_id, user_id, amount, currency, status, provider, provider_ref, stripe_event_id)
    VALUES (p_ride_id, p_rider_id, p_gross_cents / 100.0, p_currency, 'captured', 'stripe', p_provider_ref, p_event_id)
    RETURNING id INTO v_ledger_id;
    INSERT INTO wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
    VALUES (v_driver_uid, p_ride_id, (v_split->>'driver_net')::bigint, 'driver_payout', 'Card ride earnings', 'completed');
    INSERT INTO wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
    VALUES (v_platform_account, p_ride_id, (v_split->>'platform_fee')::bigint, 'ride_payment', 'Platform commission on card ride', 'completed');
    IF (v_split->>'reserve')::bigint > 0 THEN
        INSERT INTO wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
        VALUES (v_platform_account, p_ride_id, (v_split->>'reserve')::bigint, 'capital_reserve', 'Capital Reserve (War Chest) on card ride', 'completed');
        INSERT INTO capital_reserve_ledger (ride_id, amount_cents, status, notes)
        VALUES (p_ride_id, (v_split->>'reserve')::bigint, 'locked', 'Card ride — reserve locked via Stripe settlement');
    END IF;
    PERFORM public.record_ride_kickbacks(p_ride_id, p_rider_id, p_gross_cents, v_split);
    UPDATE rides
    SET payment_status = 'captured',
        driver_payout_cents = (v_split->>'driver_net')::bigint,
        reserve_cents = (v_split->>'reserve')::bigint,
        platform_fee_cents = (v_split->>'platform_fee')::bigint
    WHERE id = p_ride_id;
    INSERT INTO public.processed_stripe_events (event_id, status)
    VALUES (p_event_id, 'SUCCESS')
    ON CONFLICT (event_id) DO UPDATE SET status = 'SUCCESS', processed_at = NOW();
    RETURN jsonb_build_object('status', 'SUCCESS', 'ledger_id', v_ledger_id, 'gross_cents', p_gross_cents,
        'reserve_cents', (v_split->>'reserve')::bigint, 'platform_fee_cents', (v_split->>'platform_fee')::bigint,
        'driver_net_cents', (v_split->>'driver_net')::bigint, 'commander_cents', (v_split->>'commander_cut')::bigint,
        'vendor_cents', (v_split->>'vendor_cut')::bigint);
EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.processed_stripe_events (event_id, status)
    VALUES (p_event_id, 'FAILED')
    ON CONFLICT (event_id) DO UPDATE SET status = 'FAILED', processed_at = NOW();
    INSERT INTO system_alerts (type, severity, title, details)
    VALUES ('PAYMENT_ANOMALY', 'CRITICAL', 'Atomic settlement failed for event ' || p_event_id,
        jsonb_build_object('ride_id', p_ride_id, 'error', SQLERRM, 'event_id', p_event_id));
    RAISE;
END;
$function$;

CREATE OR REPLACE FUNCTION "public"."get_wallet_balance"("p_user_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
BEGIN
    IF p_user_id != auth.uid() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    RETURN COALESCE((SELECT SUM(amount) FROM public.wallet_transactions WHERE user_id = p_user_id), 0);
END;
$$;

CREATE OR REPLACE FUNCTION "public"."process_merchant_billing"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
    rec RECORD; v_balance INTEGER; v_fee INTEGER; v_pin_fee INTEGER; v_total_fee INTEGER;
    v_master_on BOOLEAN; v_charged INTEGER := 0; v_overdue INTEGER := 0; v_activated INTEGER := 0;
BEGIN
    SELECT is_active INTO v_master_on FROM public.system_feature_flags WHERE id = 'merchant_billing_enabled';
    IF NOT COALESCE(v_master_on, false) THEN
        RETURN jsonb_build_object('skipped', 'master_switch_off', 'run_at', now());
    END IF;
    SELECT value_cents INTO v_fee FROM public.pricing_config WHERE key = 'MERCHANT_MONTHLY_FEE_CENTS';
    v_fee := COALESCE(v_fee, 15000);
    UPDATE public.merchant_subscriptions
    SET status = 'active', next_billing_at = now() + INTERVAL '30 days'
    WHERE status = 'trial' AND trial_end_at <= now() AND billing_enabled = true;
    GET DIAGNOSTICS v_activated = ROW_COUNT;
    FOR rec IN
        SELECT ms.id, ms.merchant_id, m.created_by
        FROM public.merchant_subscriptions ms
        JOIN public.merchants m ON m.id = ms.merchant_id
        WHERE ms.status = 'active' AND ms.next_billing_at <= now() AND ms.billing_enabled = true
    LOOP
        SELECT COALESCE(SUM(amount), 0) INTO v_balance FROM public.wallet_transactions WHERE user_id = rec.created_by;
        v_pin_fee := public.resolve_merchant_pin_fee_cents(rec.merchant_id);
        v_total_fee := v_fee + COALESCE(v_pin_fee, 0);
        IF v_balance >= v_total_fee THEN
            INSERT INTO public.wallet_transactions (user_id, amount, transaction_type, description, status)
            VALUES (rec.created_by, -v_total_fee, 'merchant_subscription',
                    format('Monthly platform fee (%s) + pin fee (%s)', v_fee, v_pin_fee), 'completed');
            UPDATE public.merchant_subscriptions
            SET last_billed_at = now(), next_billing_at = now() + INTERVAL '30 days', overdue_since = NULL
            WHERE id = rec.id;
            v_charged := v_charged + 1;
        ELSE
            UPDATE public.merchant_subscriptions SET overdue_since = COALESCE(overdue_since, now()) WHERE id = rec.id;
            v_overdue := v_overdue + 1;
        END IF;
    END LOOP;
    RETURN jsonb_build_object('charged', v_charged, 'overdue', v_overdue, 'trials_activated', v_activated, 'run_at', now());
END;
$$;

ALTER TABLE public.wallet_transactions DROP CONSTRAINT wallet_transactions_transaction_type_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_transaction_type_check
  CHECK (transaction_type = ANY (ARRAY[
    'topup','ride_payment','refund','bonus','driver_payout','tip','commission_fee',
    'cancellation_fee','leakage_fine','debt_recovery','payout','debt_repayment',
    'lease_deduction','lease_income','capital_reserve','merchant_commission',
    'travel_package_payment','travel_package_refund','scout_referral_payout',
    'referral_bonus','merchant_subscription','merchant_purchase','delivery_payout',
    'delivery_fee_platform_share','commission_debt','debt_settlement'
  ]));

NOTIFY pgrst, 'reload schema';
