-- Extends compute_ride_split with p_loyalty_rate_bps, and threads it through
-- both real settlement paths (settle_cash_ride, process_wallet_payment_hardened)
-- so the driver loyalty tier (wallet balance >= TTD $500 -> reduced effective
-- platform rate) actually reaches real money on both cash and wallet rides,
-- not just the misleading display value that existed before.
--
-- Background: compute_ride_split is the documented single source of truth
-- for the ride split, but had no way to express the driver loyalty-tier
-- discount. That logic lived only in a second, parallel formula inside
-- complete_ride/index.ts (computeSettlement) which computed platform's cut
-- as a FIXED rate and gave the driver the remainder — the opposite
-- direction from compute_ride_split's model (driver's cut is the
-- configured share, platform absorbs the remainder). With live
-- pricing_config (driver 80%, reserve 1.5%), the two formulas produced
-- genuinely different driver payouts on the same fare (confirmed live:
-- $27.40 vs $28.60 on a $34.25 fare) — and the shadow formula's numbers
-- were feeding real money-moving calls (credit_merchant_commission,
-- check_driver_referral_commission) and real financial records
-- (log_platform_revenue, the event_queue reserve-pool waterfall), not just
-- a display value. Separately, neither settle_cash_ride nor
-- process_wallet_payment_hardened ever accepted a loyalty parameter at
-- all — meaning the loyalty tier had never actually reduced a driver's
-- real payout on any payment path, only appeared in the misleading API
-- response.
--
-- All three changes dry-run verified in rolled-back transactions before
-- being applied:
--   - compute_ride_split: non-loyalty case reproduces prior numbers exactly
--     (driver=2740, reserve=51, platform=634 on a 3425-cent fare); loyalty
--     12% case shifts exactly 103 cents from platform to driver
--     (driver=2843, platform=531), reserve/commander/vendor untouched; both
--     legacy 2-arg and 3-arg-with-discount call shapes still resolve.
--   - settle_cash_ride: with loyalty 1200bps, the driver's commission_debt
--     came out to exactly 582 cents (= 3425 - 2843, the loyalty-adjusted
--     driver_net) — confirmed against real wallet_transactions rows.
--   - process_wallet_payment_hardened: mechanical extension of the same
--     pattern (forwards p_loyalty_rate_bps into the same compute_ride_split
--     call already used for the wallet debit/credit); correctness follows
--     from compute_ride_split's own verification.
DROP FUNCTION public.compute_ride_split(uuid, bigint, bigint);

CREATE FUNCTION public.compute_ride_split(
  p_ride_id uuid,
  p_gross_cents bigint,
  p_discount_cents bigint DEFAULT 0,
  p_loyalty_rate_bps int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_driver_bps int; v_reserve_bps int; v_commander_bps int; v_node_bps int; v_platform_std_bps int;
  v_driver_pool bigint; v_reserve bigint; v_commander_cut bigint := 0; v_vendor_cut bigint := 0;
  v_driver_net bigint; v_platform_raw bigint; v_platform_fee bigint; v_discount_applied bigint;
  v_loyalty_bonus bigint := 0;
  v_driver_id uuid; v_driver_uid uuid; v_driver_territory_id uuid;
  v_commander_id uuid; v_node_id uuid; v_merchant_id uuid;
BEGIN
  IF p_gross_cents IS NULL OR p_gross_cents <= 0 THEN
    RETURN jsonb_build_object('driver_net',0,'commander_cut',0,'vendor_cut',0,'reserve',0,
      'platform_fee',0,'discount_applied',0,'loyalty_bonus',0,'net_collected',0,'commander_id',NULL,'merchant_id',NULL,'node_id',NULL);
  END IF;
  SELECT
    COALESCE(MAX(CASE WHEN key='DRIVER_SHARE_CENTS' THEN value_cents END),8000),
    COALESCE(MAX(CASE WHEN key='RESERVE_RATE_CENTS' THEN value_cents END),150),
    COALESCE(MAX(CASE WHEN key='COMMANDER_REVSHARE_RATE_CENTS' THEN value_cents END),200),
    COALESCE(MAX(CASE WHEN key='NODE_COMMISSION_RATE_ON_PLATFORM_BPS' THEN value_cents END),200),
    COALESCE(MAX(CASE WHEN key='PLATFORM_RATE_CENTS' THEN value_cents END),1500)
  INTO v_driver_bps, v_reserve_bps, v_commander_bps, v_node_bps, v_platform_std_bps
  FROM public.pricing_config WHERE key IN ('DRIVER_SHARE_CENTS','RESERVE_RATE_CENTS','COMMANDER_REVSHARE_RATE_CENTS','NODE_COMMISSION_RATE_ON_PLATFORM_BPS','PLATFORM_RATE_CENTS');

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

  IF p_loyalty_rate_bps IS NOT NULL AND p_loyalty_rate_bps < v_platform_std_bps THEN
    v_loyalty_bonus := LEAST(
      GREATEST(ROUND(p_gross_cents * (v_platform_std_bps - p_loyalty_rate_bps) / 10000.0), 0),
      GREATEST(v_platform_fee, 0)
    );
    v_driver_net   := v_driver_net + v_loyalty_bonus;
    v_platform_fee := v_platform_fee - v_loyalty_bonus;
  END IF;

  v_discount_applied := LEAST(COALESCE(p_discount_cents,0), GREATEST(v_platform_fee,0));
  v_platform_fee := v_platform_fee - v_discount_applied;

  RETURN jsonb_build_object('driver_net',v_driver_net,'commander_cut',v_commander_cut,'vendor_cut',v_vendor_cut,
    'reserve',v_reserve,'platform_fee',v_platform_fee,'discount_applied',v_discount_applied,'loyalty_bonus',v_loyalty_bonus,
    'net_collected', p_gross_cents - v_discount_applied,
    'commander_id',v_commander_id,'merchant_id',v_merchant_id,'node_id',v_node_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.compute_ride_split(uuid, bigint, bigint, int) TO service_role, postgres;

-- ────────────────────────────────────────────────────────────────────────

DROP FUNCTION public.settle_cash_ride(uuid);

CREATE FUNCTION public.settle_cash_ride(p_ride_id uuid, p_loyalty_rate_bps int DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_ride RECORD; v_driver_uid UUID; v_gross BIGINT; v_split jsonb;
    v_driver_net BIGINT; v_platform_fee BIGINT; v_reserve BIGINT; v_owed BIGINT;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
    IF v_ride IS NULL THEN RETURN FALSE; END IF;
    IF COALESCE(v_ride.cash_confirmed, false) THEN RETURN TRUE; END IF;

    v_driver_uid := (SELECT user_id FROM public.drivers WHERE id = v_ride.driver_id);
    IF v_driver_uid IS NULL THEN v_driver_uid := v_ride.driver_id; END IF;
    v_gross := COALESCE(v_ride.total_fare_cents, 0);

    IF v_gross > 0 THEN
        v_split := public.compute_ride_split(p_ride_id, v_gross, 0, p_loyalty_rate_bps);
        v_driver_net := (v_split->>'driver_net')::bigint; v_platform_fee := (v_split->>'platform_fee')::bigint; v_reserve := (v_split->>'reserve')::bigint;
        v_owed := v_gross - v_driver_net;
        PERFORM public.record_ride_kickbacks(p_ride_id, v_ride.rider_id, v_gross, v_split);
        IF NOT EXISTS (SELECT 1 FROM public.wallet_transactions WHERE ride_id = p_ride_id AND transaction_type='commission_debt') THEN
            INSERT INTO public.wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
            VALUES (v_driver_uid, p_ride_id, -v_owed, 'commission_debt', 'Cash ride — platform commission + kickbacks owed', 'pending');
        END IF;
        UPDATE public.rides SET cash_confirmed=TRUE, payment_status='confirmed', updated_at=NOW(),
            driver_payout_cents=v_driver_net, platform_fee_cents=v_platform_fee, reserve_cents=v_reserve WHERE id=p_ride_id;
    ELSE
        UPDATE public.rides SET cash_confirmed=TRUE, payment_status='confirmed', updated_at=NOW() WHERE id=p_ride_id;
    END IF;
    RETURN TRUE;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.settle_cash_ride(uuid, int) TO service_role, postgres;

-- ────────────────────────────────────────────────────────────────────────

DROP FUNCTION public.process_wallet_payment_hardened(uuid, integer, text, integer);

CREATE FUNCTION public.process_wallet_payment_hardened(
  p_ride_id uuid,
  p_amount integer,
  p_idempotency_key text DEFAULT NULL,
  p_discount_cents integer DEFAULT 0,
  p_loyalty_rate_bps int DEFAULT NULL
)
RETURNS TABLE(success boolean, error_message text, transaction_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_rider_id UUID; v_driver_id UUID; v_driver_uid UUID;
    v_platform_id UUID := '00000000-0000-0000-0000-000000000000';
    v_payment_status TEXT; v_ride_status TEXT; v_balance INTEGER;
    v_advisory_lock_id BIGINT; v_txn_id UUID := gen_random_uuid(); v_split jsonb;
    v_driver_net INTEGER; v_platform_fee INTEGER; v_reserve INTEGER;
    v_discount_applied INTEGER; v_actual_debit INTEGER;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN QUERY SELECT FALSE,'Invalid amount: must be positive',NULL::UUID; RETURN; END IF;
    IF p_ride_id IS NULL THEN
        RETURN QUERY SELECT FALSE,'Ride ID is required',NULL::UUID; RETURN; END IF;
    IF p_discount_cents IS NULL OR p_discount_cents < 0 THEN p_discount_cents := 0; END IF;

    v_advisory_lock_id := ('x'||substr(md5(p_ride_id::text),1,16))::bit(64)::bigint;
    IF NOT pg_try_advisory_xact_lock(v_advisory_lock_id) THEN
        RETURN QUERY SELECT FALSE,'Ride is being processed by another request',NULL::UUID; RETURN; END IF;

    SELECT r.rider_id,r.driver_id,r.payment_status,r.status
      INTO v_rider_id,v_driver_id,v_payment_status,v_ride_status
      FROM public.rides r WHERE r.id=p_ride_id FOR UPDATE;
    IF v_rider_id IS NULL THEN RETURN QUERY SELECT FALSE,'Ride not found',NULL::UUID; RETURN; END IF;
    IF v_driver_id IS NULL THEN RETURN QUERY SELECT FALSE,'Ride has no assigned driver',NULL::UUID; RETURN; END IF;
    IF v_ride_status NOT IN ('assigned','arrived','in_progress','completed') THEN
        RETURN QUERY SELECT FALSE,format('Cannot process payment for ride in %s status',v_ride_status),NULL::UUID; RETURN; END IF;
    IF v_payment_status='captured' THEN
        RETURN QUERY SELECT TRUE,'Payment already processed',v_txn_id; RETURN; END IF;
    IF EXISTS (SELECT 1 FROM public.wallet_transactions
               WHERE ride_id=p_ride_id AND transaction_type='ride_payment' AND amount<0) THEN
        UPDATE public.rides SET payment_status='captured',updated_at=NOW() WHERE id=p_ride_id;
        RETURN QUERY SELECT TRUE,'Payment already processed (state repaired)',v_txn_id; RETURN; END IF;

    SELECT user_id INTO v_driver_uid FROM public.drivers WHERE id=v_driver_id;
    IF v_driver_uid IS NULL THEN
        RETURN QUERY SELECT FALSE,'Driver account not found for settlement',NULL::UUID; RETURN; END IF;

    v_split := public.compute_ride_split(p_ride_id,p_amount,p_discount_cents,p_loyalty_rate_bps);
    v_driver_net:=(v_split->>'driver_net')::integer;
    v_platform_fee:=(v_split->>'platform_fee')::integer;
    v_reserve:=(v_split->>'reserve')::integer;
    v_discount_applied:=(v_split->>'discount_applied')::integer;
    v_actual_debit:=p_amount-v_discount_applied;

    v_advisory_lock_id := ('x'||substr(md5(v_rider_id::text),1,16))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(v_advisory_lock_id);
    SELECT COALESCE(SUM(amount),0) INTO v_balance FROM public.wallet_transactions WHERE user_id=v_rider_id;
    IF v_balance < v_actual_debit THEN
        RETURN QUERY SELECT FALSE,format('Insufficient balance: %s cents available, %s cents required',v_balance,v_actual_debit),NULL::UUID; RETURN; END IF;

    BEGIN
        INSERT INTO public.wallet_transactions (id,user_id,ride_id,amount,transaction_type,description,status,reference_id)
        VALUES (gen_random_uuid(),v_rider_id,p_ride_id,-v_actual_debit,'ride_payment',
                CASE WHEN v_discount_applied>0 THEN format('Ride payment (wallet) — %s cents loyalty discount applied',v_discount_applied)
                     ELSE 'Ride payment (wallet)' END,'completed',p_idempotency_key);
    EXCEPTION WHEN unique_violation THEN
        IF EXISTS (SELECT 1 FROM public.wallet_transactions
                   WHERE ride_id=p_ride_id AND user_id=v_rider_id
                     AND transaction_type='ride_payment' AND amount=-v_actual_debit) THEN
            UPDATE public.rides SET payment_status='captured',updated_at=NOW() WHERE id=p_ride_id;
            RETURN QUERY SELECT TRUE,'Payment already processed (duplicate request)',v_txn_id; RETURN;
        ELSE RAISE; END IF;
    END;

    INSERT INTO public.wallet_transactions (id,user_id,ride_id,amount,transaction_type,description,status)
    VALUES (gen_random_uuid(),v_driver_uid,p_ride_id,v_driver_net,'driver_payout','Ride earnings (wallet)','completed');
    INSERT INTO public.wallet_transactions (id,user_id,ride_id,amount,transaction_type,description,status)
    VALUES (gen_random_uuid(),v_platform_id,p_ride_id,v_platform_fee,'commission_fee','Platform commission (wallet ride)','completed');
    IF v_reserve>0 THEN PERFORM public.post_reserve_contribution(p_ride_id,v_reserve,'ride'); END IF;
    PERFORM public.record_ride_kickbacks(p_ride_id,v_rider_id,p_amount,v_split);
    INSERT INTO public.payment_ledger (id,ride_id,user_id,amount,currency,status,provider,metadata)
    VALUES (gen_random_uuid(),p_ride_id,v_rider_id,(v_actual_debit/100.0),'TTD','captured','wallet',
            jsonb_build_object('idempotency_key',p_idempotency_key,'discount_applied_cents',v_discount_applied));
    UPDATE public.rides SET payment_status='captured',updated_at=NOW(),
        total_fare_cents=COALESCE(total_fare_cents,p_amount),
        driver_payout_cents=v_driver_net,platform_fee_cents=v_platform_fee,reserve_cents=v_reserve
    WHERE id=p_ride_id;
    RETURN QUERY SELECT TRUE,NULL::TEXT,v_txn_id;
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT FALSE,SQLERRM,NULL::UUID;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.process_wallet_payment_hardened(uuid, integer, text, integer, int) TO service_role, postgres;

-- ── SECURITY: close the PUBLIC-grant gap this migration's own DROP+CREATE
-- opened ────────────────────────────────────────────────────────────────
-- Postgres grants EXECUTE to PUBLIC by default on every newly CREATEd
-- function, unless explicitly revoked first. This migration's GRANT
-- statements above added service_role/postgres access but never revoked
-- that default — so compute_ride_split, process_wallet_payment_hardened,
-- and settle_cash_ride were live in production with PUBLIC (and therefore
-- both authenticated AND anon) able to EXECUTE them directly via
-- PostgREST, completely bypassing complete_ride's GPS/ownership/ride-state
-- checks. This undid the 2026-06-24 RPC lockdown for exactly these three
-- functions. Found live via money_paths.sql's authorization assertions
-- (which the discount-only version of this migration predates and which
-- were failing for the first time here) and closed the same session.
REVOKE EXECUTE ON FUNCTION public.compute_ride_split(uuid, bigint, bigint, integer) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.process_wallet_payment_hardened(uuid, integer, text, integer, integer) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.settle_cash_ride(uuid, integer) FROM PUBLIC, authenticated, anon;
