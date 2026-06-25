-- ════════════════════════════════════════════════════════════════════════
-- SETTLEMENT CONSOLIDATION — single source of truth + wallet path → 82/15/3
-- ════════════════════════════════════════════════════════════════════════
-- 1. gtaxi_settlement(gross): the ONE function every settlement path uses.
--    Reads PLATFORM_RATE_CENTS + RESERVE_RATE_CENTS from pricing_config.
--    driver = gross − platform − reserve  (82% / loyalty 85%).
-- 2. Rewrites process_wallet_payment_hardened (previously hardcoded 0.19,
--    no reserve, driver 81%) to call it — so wallet rides now settle 82/15/3
--    AND fund the growth reserve, matching the cash and card paths.
-- Invariant: platform_fee + reserve + driver_payout = gross.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.gtaxi_settlement(p_gross_cents BIGINT)
RETURNS TABLE (platform_fee_cents BIGINT, reserve_cents BIGINT, driver_payout_cents BIGINT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH r AS (
    SELECT
      COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'PLATFORM_RATE_CENTS'), 1500) AS plat_bps,
      COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'RESERVE_RATE_CENTS'), 300)  AS res_bps
  )
  SELECT
    ROUND(p_gross_cents * r.plat_bps / 10000.0)::bigint AS platform_fee_cents,
    ROUND(p_gross_cents * r.res_bps  / 10000.0)::bigint AS reserve_cents,
    (p_gross_cents
       - ROUND(p_gross_cents * r.plat_bps / 10000.0)
       - ROUND(p_gross_cents * r.res_bps  / 10000.0))::bigint AS driver_payout_cents
  FROM r;
$$;

CREATE OR REPLACE FUNCTION public.process_wallet_payment_hardened(
    p_ride_id   UUID,
    p_amount    INTEGER,
    p_idempotency_key TEXT DEFAULT NULL
) RETURNS TABLE (
    success BOOLEAN,
    error_message TEXT,
    transaction_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_rider_id       UUID;
    v_driver_id      UUID;
    v_platform_id    UUID := '00000000-0000-0000-0000-000000000000';
    v_payment_status TEXT;
    v_ride_status    TEXT;
    v_balance        INTEGER;
    v_driver_net     INTEGER;
    v_platform_fee   INTEGER;
    v_reserve        INTEGER;
    v_advisory_lock_id BIGINT;
    v_txn_id         UUID := gen_random_uuid();
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

    -- ── Step 5: Canonical 82/15/3 split (single source of truth) ──────────────
    SELECT platform_fee_cents, reserve_cents, driver_payout_cents
    INTO v_platform_fee, v_reserve, v_driver_net
    FROM public.gtaxi_settlement(p_amount::bigint);

    -- 6A. Debit rider
    BEGIN
        INSERT INTO public.wallet_transactions
            (id, user_id, ride_id, amount, transaction_type, description, status, metadata)
        VALUES
            (gen_random_uuid(), v_rider_id, p_ride_id, -p_amount, 'ride_payment',
             'Ride payment (wallet)', 'completed',
             jsonb_build_object('idempotency_key', p_idempotency_key));
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

    -- 6B. Credit driver (82%)
    INSERT INTO public.wallet_transactions
        (id, user_id, ride_id, amount, transaction_type, description, status)
    VALUES
        (gen_random_uuid(), v_driver_id, p_ride_id, v_driver_net, 'driver_payout',
         'Ride earnings (82%)', 'completed');

    -- 6C. Credit platform (15%)
    INSERT INTO public.wallet_transactions
        (id, user_id, ride_id, amount, transaction_type, description, status)
    VALUES
        (gen_random_uuid(), v_platform_id, p_ride_id, v_platform_fee, 'platform_commission',
         'Platform commission (15%)', 'completed');

    -- 6C-bis. Credit growth reserve (3%) + lock in capital_reserve_ledger
    INSERT INTO public.wallet_transactions
        (id, user_id, ride_id, amount, transaction_type, description, status)
    VALUES
        (gen_random_uuid(), v_platform_id, p_ride_id, v_reserve, 'capital_reserve',
         '3% Growth Reserve (War Chest) on wallet ride', 'completed');

    INSERT INTO public.capital_reserve_ledger (ride_id, amount_cents, status, notes)
    VALUES (p_ride_id, v_reserve, 'locked', 'Wallet ride — reserve locked via wallet settlement');

    -- 6D. payment_ledger
    INSERT INTO public.payment_ledger
        (id, ride_id, user_id, amount, currency, status, provider, metadata)
    VALUES
        (gen_random_uuid(), p_ride_id, v_rider_id, (p_amount / 100.0), 'TTD',
         'captured', 'wallet', jsonb_build_object('idempotency_key', p_idempotency_key));

    -- 6E. Mark ride captured + record breakdown
    UPDATE public.rides
    SET payment_status = 'captured',
        updated_at = NOW(),
        total_fare_cents = COALESCE(total_fare_cents, p_amount),
        driver_payout_cents = v_driver_net,
        reserve_cents = v_reserve,
        platform_fee_cents = v_platform_fee
    WHERE id = p_ride_id;

    RETURN QUERY SELECT TRUE, NULL::TEXT, v_txn_id;

EXCEPTION
    WHEN OTHERS THEN
        RETURN QUERY SELECT FALSE, SQLERRM, NULL::UUID;
END;
$$;
