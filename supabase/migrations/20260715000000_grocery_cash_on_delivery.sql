-- =============================================================================
-- Grocery cash-on-delivery: fix a half-built, currently-broken path.
--
-- GroceryCartScreen.tsx already has a cash toggle and inserts orders with
-- payment_status='cash_on_delivery' directly from the client — but that
-- value isn't in orders_payment_status_check, so tapping "cash" throws a DB
-- error today. Separately, the existing settlement RPC
-- (process_cash_delivery_settlement) pays the merchant but folds the
-- delivery fee into the merchant-commission base (wrong — delivery fee
-- isn't merchant revenue) and never pays the driver anything for their
-- labor, only ever debits them. And independently, merchants are never
-- paid AT ALL for card/wallet grocery orders — process_order_delivery_payment
-- only ever paid the driver.
--
-- This migration:
--   1. Legalizes 'cash_on_delivery' in orders_payment_status_check.
--   2. Extracts driver-payout math (base + PER_KM_CENTS distance, added
--      2026-07-14) into calculate_delivery_driver_payout() so cash and
--      card/wallet settlement can't drift apart on what a driver earns.
--   3. Extracts merchant-cut math (goods subtotal only, NOT delivery fee)
--      into calculate_delivery_merchant_cut().
--   4. Rewrites process_cash_delivery_settlement to actually pay the driver
--      (shadow-ledger: driver keeps the cash, platform debits its share —
--      same model complete_ride already uses for cash rides) and to gate
--      on proof-of-delivery like the card/wallet path already does.
--   5. Extends process_order_delivery_payment to also credit the merchant
--      (closes the card/wallet merchant-payout gap).
-- =============================================================================

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status = ANY (ARRAY['pending','authorized','captured','failed','refunded','cash_on_delivery']));

-- ── Shared helper: driver payout (base labor + real distance) ───────────────
CREATE OR REPLACE FUNCTION public.calculate_delivery_driver_payout(p_order_id uuid)
RETURNS TABLE(base_cents integer, distance_km numeric, distance_cents integer, payout_cents integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_order          RECORD;
    v_merchant       RECORD;
    v_base_cents     integer;
    v_per_km_cents   integer;
    v_distance_km    numeric;
    v_distance_cents integer;
BEGIN
    SELECT o.merchant_id, o.delivery_lat, o.delivery_lng INTO v_order FROM public.orders o WHERE o.id = p_order_id;

    v_base_cents := COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'DELIVERY_DRIVER_PAYOUT_CENTS'), 2000);
    v_per_km_cents := COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'PER_KM_CENTS'), 175);

    SELECT lat, lng INTO v_merchant FROM public.merchants WHERE id = v_order.merchant_id;

    IF v_merchant.lat IS NOT NULL AND v_merchant.lng IS NOT NULL
       AND v_order.delivery_lat IS NOT NULL AND v_order.delivery_lng IS NOT NULL THEN
        v_distance_km := ST_DistanceSphere(
            ST_MakePoint(v_merchant.lng, v_merchant.lat),
            ST_MakePoint(v_order.delivery_lng, v_order.delivery_lat)
        ) / 1000.0;
    ELSE
        v_distance_km := 0;
    END IF;

    v_distance_cents := ROUND(v_distance_km * v_per_km_cents)::integer;

    RETURN QUERY SELECT v_base_cents, v_distance_km, v_distance_cents, v_base_cents + v_distance_cents;
END;
$$;
REVOKE ALL ON FUNCTION public.calculate_delivery_driver_payout(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_delivery_driver_payout(uuid) TO authenticated, service_role;

-- ── Shared helper: merchant cut (goods subtotal only, NOT delivery fee) ─────
CREATE OR REPLACE FUNCTION public.calculate_delivery_merchant_cut(p_order_id uuid)
RETURNS TABLE(goods_subtotal_cents integer, merchant_cut_cents integer, platform_cut_cents integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_order          RECORD;
    v_platform_rate  numeric;
    v_subtotal       integer;
    v_cut            integer;
BEGIN
    SELECT total_cents, delivery_fee_cents INTO v_order FROM public.orders WHERE id = p_order_id;

    v_subtotal := GREATEST(COALESCE(v_order.total_cents, 0) - COALESCE(v_order.delivery_fee_cents, 0), 0);
    v_platform_rate := COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'PLATFORM_RATE_CENTS_DELIVERY'), 1500) / 10000.0;
    v_cut := ROUND(v_subtotal * (1 - v_platform_rate))::integer;

    RETURN QUERY SELECT v_subtotal, v_cut, v_subtotal - v_cut;
END;
$$;
REVOKE ALL ON FUNCTION public.calculate_delivery_merchant_cut(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_delivery_merchant_cut(uuid) TO authenticated, service_role;

-- ── process_order_delivery_payment: now also pays the merchant ──────────────
CREATE OR REPLACE FUNCTION public.process_order_delivery_payment(p_order_id uuid, p_photo_url text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_order              RECORD;
    v_driver_auth_id     uuid;
    v_merchant_owner_id  uuid;
    v_platform_id        uuid := '00000000-0000-0000-0000-000000000000';
    v_advisory_lock_id   bigint;
    v_txn_id             uuid := gen_random_uuid();
    v_payout             RECORD;
    v_merchant_cut       RECORD;
    v_platform_share     integer;
BEGIN
    v_advisory_lock_id := ('x' || substr(md5(p_order_id::text), 1, 16))::bit(64)::bigint;
    IF NOT pg_try_advisory_xact_lock(v_advisory_lock_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order is being processed by another request');
    END IF;

    SELECT * INTO v_order FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;
    IF v_order.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order not found');
    END IF;
    IF v_order.delivery_driver_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order has no assigned delivery driver');
    END IF;

    SELECT user_id INTO v_driver_auth_id FROM public.drivers WHERE id = v_order.delivery_driver_id;
    IF v_driver_auth_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Driver account not found for settlement');
    END IF;

    IF v_order.driver_payout_status = 'paid' THEN
        RETURN jsonb_build_object('success', true, 'message', 'Already paid', 'transaction_id', v_txn_id);
    END IF;

    IF v_order.driver_payout_status = 'pending' AND v_order.status NOT IN ('confirmed', 'out_for_delivery') THEN
        RETURN jsonb_build_object('success', false, 'error', format('Cannot deliver order in %s status', v_order.status));
    END IF;

    IF p_photo_url IS NULL AND v_order.delivery_photo_url IS NULL THEN
        UPDATE public.orders
           SET status = 'delivered', actual_delivery_at = COALESCE(actual_delivery_at, now()), driver_payout_status = 'held_no_proof'
         WHERE id = p_order_id;
        RETURN jsonb_build_object('success', true, 'message', 'Delivered, but payout held — no proof-of-delivery photo', 'held', true);
    END IF;

    SELECT * INTO v_payout FROM public.calculate_delivery_driver_payout(p_order_id);
    v_platform_share := GREATEST(COALESCE(v_order.delivery_fee_cents, 0) - v_payout.payout_cents, 0);

    INSERT INTO public.wallet_transactions (id, user_id, amount, transaction_type, description, reference_id, status)
    VALUES (gen_random_uuid(), v_driver_auth_id, v_payout.payout_cents, 'delivery_payout',
            format('Delivery payout — order %s (%s base + %s over %skm)', p_order_id::text, v_payout.base_cents, v_payout.distance_cents, round(v_payout.distance_km, 1)),
            'order:' || p_order_id::text, 'completed');

    IF v_platform_share > 0 THEN
        INSERT INTO public.wallet_transactions (id, user_id, amount, transaction_type, description, reference_id, status)
        VALUES (gen_random_uuid(), v_platform_id, v_platform_share, 'delivery_fee_platform_share',
                'Delivery fee platform share — order ' || p_order_id::text, 'order:' || p_order_id::text, 'completed');
    END IF;

    -- Merchant payout — previously never happened for card/wallet orders.
    IF v_order.merchant_payout_status IS DISTINCT FROM 'paid' THEN
        SELECT * INTO v_merchant_cut FROM public.calculate_delivery_merchant_cut(p_order_id);
        SELECT created_by INTO v_merchant_owner_id FROM public.merchants WHERE id = v_order.merchant_id;

        IF v_merchant_owner_id IS NOT NULL THEN
            INSERT INTO public.wallet_transactions (id, user_id, amount, transaction_type, description, reference_id, status)
            VALUES (gen_random_uuid(), v_merchant_owner_id, v_merchant_cut.merchant_cut_cents, 'merchant_commission',
                    'Merchant payout — order ' || p_order_id::text, 'order:' || p_order_id::text, 'completed');

            UPDATE public.orders
               SET merchant_payout_status = 'paid', merchant_paid_cents = v_merchant_cut.merchant_cut_cents, merchant_paid_at = now()
             WHERE id = p_order_id;
        END IF;
    END IF;

    PERFORM public.log_platform_revenue(
        p_ride_id := NULL::uuid, p_order_id := p_order_id, p_merchant_id := v_order.merchant_id,
        p_gross_cents := COALESCE(v_order.delivery_fee_cents, 0), p_payout_cents := v_payout.payout_cents,
        p_merchant_earnings_cents := COALESCE(v_merchant_cut.merchant_cut_cents, 0), p_reserve_cents := 0
    );

    UPDATE public.orders
       SET status = 'delivered',
           actual_delivery_at = COALESCE(actual_delivery_at, now()),
           driver_paid_cents = v_payout.payout_cents,
           driver_payout_status = 'paid',
           delivery_photo_url = COALESCE(p_photo_url, v_order.delivery_photo_url)
     WHERE id = p_order_id;

    RETURN jsonb_build_object(
        'success', true, 'transaction_id', v_txn_id, 'driver_payout_cents', v_payout.payout_cents,
        'base_cents', v_payout.base_cents, 'distance_km', round(v_payout.distance_km, 2), 'distance_cents', v_payout.distance_cents,
        'merchant_cut_cents', v_merchant_cut.merchant_cut_cents
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.process_order_delivery_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_order_delivery_payment(uuid, text) TO authenticated, service_role;

-- ── process_cash_delivery_settlement: now actually pays the driver ──────────
-- Adding p_photo_url changes the signature (3-arg -> 4-arg) — CREATE OR
-- REPLACE would leave the old 3-arg version as a second overload rather than
-- replacing it, the exact ambiguity trap hit earlier with log_platform_revenue.
DROP FUNCTION IF EXISTS public.process_cash_delivery_settlement(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.process_cash_delivery_settlement(p_order_id uuid, p_driver_user_id uuid, p_merchant_id uuid, p_photo_url text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_order              RECORD;
    v_merchant_owner_id  uuid;
    v_payout             RECORD;
    v_merchant_cut       RECORD;
    v_driver_debit_cents integer;
    v_advisory_lock_id   bigint;
BEGIN
    v_advisory_lock_id := ('x' || substr(md5(p_order_id::text), 1, 16))::bit(64)::bigint;
    IF NOT pg_try_advisory_xact_lock(v_advisory_lock_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order is being processed by another request');
    END IF;

    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order not found');
    END IF;
    IF v_order.payment_status != 'cash_on_delivery' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order is not cash-on-delivery');
    END IF;
    IF v_order.merchant_payout_status = 'paid' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Already settled');
    END IF;

    -- Proof-of-delivery gate, same bar as the card/wallet path.
    IF p_photo_url IS NULL AND v_order.delivery_photo_url IS NULL THEN
        UPDATE public.orders
           SET status = 'delivered', actual_delivery_at = COALESCE(actual_delivery_at, now()), driver_payout_status = 'held_no_proof'
         WHERE id = p_order_id;
        RETURN jsonb_build_object('success', true, 'message', 'Delivered, but settlement held — no proof-of-delivery photo', 'held', true);
    END IF;

    SELECT * INTO v_payout FROM public.calculate_delivery_driver_payout(p_order_id);
    SELECT * INTO v_merchant_cut FROM public.calculate_delivery_merchant_cut(p_order_id);
    SELECT created_by INTO v_merchant_owner_id FROM public.merchants WHERE id = p_merchant_id;
    IF v_merchant_owner_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Merchant has no owner');
    END IF;

    -- Driver already holds total_cents cash in hand. They keep their own
    -- payout; everything else (merchant's cut + platform's cut) is debited
    -- from their wallet — same shadow-ledger model complete_ride uses for
    -- cash rides (driver owes the platform, doesn't hand over physical cash).
    v_driver_debit_cents := COALESCE(v_order.total_cents, 0) - v_payout.payout_cents;

    INSERT INTO wallet_transactions (user_id, reference_id, amount, transaction_type, description, status)
    VALUES (v_merchant_owner_id, 'order:' || p_order_id::text, v_merchant_cut.merchant_cut_cents, 'merchant_commission',
            'Cash delivery settlement — order ' || p_order_id::text, 'completed');

    INSERT INTO wallets (user_id, balance_cents)
    VALUES (v_merchant_owner_id, v_merchant_cut.merchant_cut_cents)
    ON CONFLICT (user_id) DO UPDATE SET balance_cents = wallets.balance_cents + v_merchant_cut.merchant_cut_cents;

    INSERT INTO wallet_transactions (user_id, reference_id, amount, transaction_type, description, status)
    VALUES (p_driver_user_id, 'order:' || p_order_id::text, -v_driver_debit_cents, 'commission_fee',
            format('Platform + merchant share on cash delivery — order %s (driver collected %s cents, kept %s as payout)',
                   p_order_id::text, v_order.total_cents, v_payout.payout_cents),
            'completed');

    UPDATE orders SET
        merchant_payout_status = 'paid',
        merchant_paid_cents = v_merchant_cut.merchant_cut_cents,
        merchant_paid_at = now(),
        cash_collected = true,
        cash_collected_at = now(),
        status = 'delivered',
        actual_delivery_at = COALESCE(actual_delivery_at, now()),
        driver_paid_cents = v_payout.payout_cents,
        driver_payout_status = 'paid',
        delivery_photo_url = COALESCE(p_photo_url, delivery_photo_url)
    WHERE id = p_order_id;

    INSERT INTO platform_revenue_logs (order_id, merchant_id, gross_amount_cents, platform_fee_cents, driver_payout_cents, merchant_split_cents)
    VALUES (p_order_id, p_merchant_id, v_order.total_cents,
            v_order.total_cents - v_merchant_cut.merchant_cut_cents - v_payout.payout_cents, v_payout.payout_cents, v_merchant_cut.merchant_cut_cents);

    RETURN jsonb_build_object(
        'success', true,
        'merchant_credited_cents', v_merchant_cut.merchant_cut_cents,
        'driver_payout_cents', v_payout.payout_cents,
        'driver_debited_cents', v_driver_debit_cents,
        'merchant_owner', v_merchant_owner_id
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.process_cash_delivery_settlement(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_cash_delivery_settlement(uuid, uuid, uuid, text) TO authenticated, service_role;
