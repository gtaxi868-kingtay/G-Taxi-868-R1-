-- ═══════════════════════════════════════════════════════════════════
-- P0: DRIVER WALLET IDENTITY BUG + COMMANDER-ON-WALLET/CARD (2026-07-16)
--
-- Found while wiring commander revshare into the wallet/card paths (the
-- owner's explicit ask): both process_wallet_payment_hardened (wallet
-- rides) and process_driver_settlement_atomic (card/Stripe rides) credit
-- driver earnings to wallet_transactions.user_id = rides.driver_id.
-- rides.driver_id → drivers.id, NOT the driver's auth user id
-- (drivers.user_id). Every other correct caller in the codebase resolves
-- through drivers.user_id first (see resolveDriverAuthUserId in
-- complete_ride, compute_ride_split). These two did not.
--
-- Because zero card/wallet settlement has ever run in production
-- (Stripe keys unset; verified via wallet_transactions count = 0), this
-- has never actually lost anyone money — but it would have, the moment
-- a real card or wallet ride settled: the credit would land under an id
-- that get_wallet_balance()'s own auth.uid()-only check makes
-- unreachable by the driver who earned it. This migration and its
-- matching WalletScreen.tsx fix close that before it can happen.
--
-- Both functions are also rewritten to call compute_ride_split (the one
-- source of truth already used by the cash path) instead of their own
-- hand-rolled formulas — this is what actually fixes the commander gap:
-- compute_ride_split already resolves the driver's commander via
-- profiles.referred_by_commander_id and carves the cut from the driver's
-- pool. It also picks up node "rent" (settlement v3, same session) for
-- wallet/card rides dispatched from a kiosk, which neither function
-- handled before. Hardening (advisory locks, idempotency, balance
-- checks) is preserved from each original.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. process_wallet_payment_hardened — identity fix + compute_ride_split ──
CREATE OR REPLACE FUNCTION "public"."process_wallet_payment_hardened"("p_ride_id" "uuid", "p_amount" integer, "p_idempotency_key" "text" DEFAULT NULL::"text")
RETURNS TABLE("success" boolean, "error_message" "text", "transaction_id" "uuid")
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_rider_id       UUID;
    v_driver_id      UUID;  -- drivers.id (ride's FK)
    v_driver_uid     UUID;  -- driver's AUTH id — resolved from drivers.user_id
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
    FROM public.rides r
    WHERE r.id = p_ride_id
    FOR UPDATE;

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

    SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.wallet_transactions WHERE user_id = v_rider_id;

    IF v_balance < p_amount THEN
        RETURN QUERY SELECT FALSE, format('Insufficient balance: %s cents available, %s cents required', v_balance, p_amount), NULL::UUID;
        RETURN;
    END IF;

    -- Resolve the driver's AUTH id — the bug this migration fixes.
    SELECT user_id INTO v_driver_uid FROM public.drivers WHERE id = v_driver_id;
    IF v_driver_uid IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Driver account not found for settlement', NULL::UUID;
        RETURN;
    END IF;

    -- Single source of truth: driver pool, reserve, commander cut (from
    -- driver pool), node rent (from platform's take) — same function the
    -- cash path uses.
    v_split := public.compute_ride_split(p_ride_id, p_amount);

    -- 6A. Debit rider (idempotency via unique constraint).
    -- NOTE: wallet_transactions has no `metadata` column — the original
    -- (pre-existing) function tried to insert one and would have crashed
    -- on the very first wallet-paid ride. Caught by dry-run before this
    -- migration went live; idempotency_key now goes in reference_id (text),
    -- the column that actually exists for this purpose.
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

    -- 6B. Credit driver — AUTH id, net of commander cut.
    INSERT INTO public.wallet_transactions
        (id, user_id, ride_id, amount, transaction_type, description, status)
    VALUES
        (gen_random_uuid(), v_driver_uid, p_ride_id, (v_split->>'driver_net')::integer, 'driver_payout',
         'Ride earnings (wallet)', 'completed');

    -- 6C. Credit platform its final fee (after commander + node carve-outs).
    -- 'platform_commission' is NOT in wallet_transactions_transaction_type_check
    -- (confirmed against the live constraint) — 'commission_fee' is the actual
    -- allowed value; the original function used the invalid one and would
    -- have crashed on the first wallet-paid ride.
    INSERT INTO public.wallet_transactions
        (id, user_id, ride_id, amount, transaction_type, description, status)
    VALUES
        (gen_random_uuid(), v_platform_id, p_ride_id, (v_split->>'platform_fee')::integer, 'commission_fee',
         'Platform commission (wallet ride)', 'completed');

    -- 6D. Reserve
    IF (v_split->>'reserve')::integer > 0 THEN
        PERFORM public.post_reserve_contribution(p_ride_id, (v_split->>'reserve')::integer, 'ride');
    END IF;

    -- 6E. Commander + node kickback ledger entries (guarded, non-duplicating).
    PERFORM public.record_ride_kickbacks(p_ride_id, v_rider_id, p_amount, v_split);

    -- 6F. payment_ledger
    INSERT INTO public.payment_ledger
        (id, ride_id, user_id, amount, currency, status, provider, metadata)
    VALUES
        (gen_random_uuid(), p_ride_id, v_rider_id, (p_amount / 100.0), 'TTD',
         'captured', 'wallet', jsonb_build_object('idempotency_key', p_idempotency_key));

    -- 6G. Ride status
    UPDATE public.rides
    SET payment_status = 'captured',
        updated_at = NOW(),
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

-- ─── 2. process_driver_settlement_atomic — identity fix + compute_ride_split ─
CREATE OR REPLACE FUNCTION "public"."process_driver_settlement_atomic"("p_event_id" "text", "p_ride_id" "uuid", "p_driver_id" "uuid", "p_rider_id" "uuid", "p_gross_cents" bigint, "p_currency" "text", "p_provider_ref" "text")
RETURNS "jsonb"
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_lock_acquired BOOLEAN;
    v_already_processed BOOLEAN;
    v_driver_uid UUID;
    v_ledger_id BIGINT;
    v_split jsonb;
    v_platform_account CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
    SELECT pg_try_advisory_xact_lock(hashtext(p_event_id)) INTO v_lock_acquired;

    IF NOT v_lock_acquired THEN
        RETURN jsonb_build_object(
            'status', 'CONFLICT',
            'error', 'Settlement for event ' || p_event_id || ' is already being processed by another thread.'
        );
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM public.processed_stripe_events
        WHERE event_id = p_event_id AND status = 'SUCCESS'
    ) INTO v_already_processed;

    IF v_already_processed THEN
        RETURN jsonb_build_object('status', 'SKIPPED', 'message', 'Event already processed.');
    END IF;

    -- p_driver_id is rides.driver_id → drivers.id, NOT the driver's auth id.
    -- Resolve it — this is the identity bug this migration fixes.
    SELECT user_id INTO v_driver_uid FROM public.drivers WHERE id = p_driver_id;
    IF v_driver_uid IS NULL THEN
        INSERT INTO public.processed_stripe_events (event_id, status)
        VALUES (p_event_id, 'FAILED')
        ON CONFLICT (event_id) DO UPDATE SET status = 'FAILED', processed_at = NOW();
        RETURN jsonb_build_object('status', 'FAILED', 'error', 'Driver account not found for settlement');
    END IF;

    -- Single source of truth: same split function the cash and (now) wallet
    -- paths use — commander cut from the driver pool, node rent from the
    -- platform's take, reserve, admin-configurable rates.
    v_split := public.compute_ride_split(p_ride_id, p_gross_cents);

    INSERT INTO payment_ledger (ride_id, user_id, amount, currency, status, provider, provider_ref, stripe_event_id)
    VALUES (p_ride_id, p_rider_id, p_gross_cents / 100.0, p_currency, 'captured', 'stripe', p_provider_ref, p_event_id)
    RETURNING id INTO v_ledger_id;

    -- Driver, AUTH id, net of commander cut.
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

    RETURN jsonb_build_object(
        'status', 'SUCCESS',
        'ledger_id', v_ledger_id,
        'gross_cents', p_gross_cents,
        'reserve_cents', (v_split->>'reserve')::bigint,
        'platform_fee_cents', (v_split->>'platform_fee')::bigint,
        'driver_net_cents', (v_split->>'driver_net')::bigint,
        'commander_cents', (v_split->>'commander_cut')::bigint,
        'vendor_cents', (v_split->>'vendor_cut')::bigint
    );

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.processed_stripe_events (event_id, status)
    VALUES (p_event_id, 'FAILED')
    ON CONFLICT (event_id) DO UPDATE SET status = 'FAILED', processed_at = NOW();

    INSERT INTO system_alerts (type, severity, title, details)
    VALUES (
        'PAYMENT_ANOMALY', 'CRITICAL',
        'Atomic settlement failed for event ' || p_event_id,
        jsonb_build_object('ride_id', p_ride_id, 'error', SQLERRM, 'event_id', p_event_id)
    );

    RAISE;
END;
$$;

-- ─── 3. process_merchant_billing — wire in the type-based pin fee ────
-- Was reading merchant_subscriptions.pin_fee_cents directly, bypassing
-- the type/agreement-based resolver built in settlement v3 (same
-- session) — that feature was dead code until this.
CREATE OR REPLACE FUNCTION "public"."process_merchant_billing"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
    rec          RECORD;
    v_balance    INTEGER;
    v_fee        INTEGER;
    v_pin_fee    INTEGER;
    v_total_fee  INTEGER;
    v_master_on  BOOLEAN;
    v_charged    INTEGER := 0;
    v_overdue    INTEGER := 0;
    v_activated  INTEGER := 0;
BEGIN
    SELECT is_active INTO v_master_on
    FROM public.system_feature_flags
    WHERE id = 'merchant_billing_enabled';

    IF NOT COALESCE(v_master_on, false) THEN
        RETURN jsonb_build_object('skipped', 'master_switch_off', 'run_at', now());
    END IF;

    SELECT value_cents INTO v_fee
    FROM public.pricing_config
    WHERE key = 'MERCHANT_MONTHLY_FEE_CENTS';
    v_fee := COALESCE(v_fee, 15000);

    UPDATE public.merchant_subscriptions
    SET status = 'active',
        next_billing_at = now() + INTERVAL '30 days'
    WHERE status = 'trial'
      AND trial_end_at <= now()
      AND billing_enabled = true;
    GET DIAGNOSTICS v_activated = ROW_COUNT;

    FOR rec IN
        SELECT ms.id, ms.merchant_id, m.created_by
        FROM public.merchant_subscriptions ms
        JOIN public.merchants m ON m.id = ms.merchant_id
        WHERE ms.status = 'active'
          AND ms.next_billing_at <= now()
          AND ms.billing_enabled = true
    LOOP
        SELECT COALESCE(balance_cents, 0) INTO v_balance
        FROM public.wallets WHERE user_id = rec.created_by;

        v_pin_fee := public.resolve_merchant_pin_fee_cents(rec.merchant_id);
        v_total_fee := v_fee + COALESCE(v_pin_fee, 0);

        IF v_balance >= v_total_fee THEN
            UPDATE public.wallets
            SET balance_cents = balance_cents - v_total_fee
            WHERE user_id = rec.created_by;

            INSERT INTO public.wallet_transactions (user_id, amount, transaction_type, description, status)
            VALUES (rec.created_by, -v_total_fee, 'merchant_subscription',
                    format('Monthly platform fee (%s) + pin fee (%s)', v_fee, v_pin_fee), 'completed');

            UPDATE public.merchant_subscriptions
            SET last_billed_at = now(), next_billing_at = now() + INTERVAL '30 days', overdue_since = NULL
            WHERE id = rec.id;

            v_charged := v_charged + 1;
        ELSE
            UPDATE public.merchant_subscriptions
            SET overdue_since = COALESCE(overdue_since, now())
            WHERE id = rec.id;

            v_overdue := v_overdue + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('charged', v_charged, 'overdue', v_overdue, 'trials_activated', v_activated, 'run_at', now());
END;
$$;

NOTIFY pgrst, 'reload schema';
