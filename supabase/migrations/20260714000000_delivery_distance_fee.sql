-- =============================================================================
-- Fix a real gap in process_order_delivery_payment (2026-07-13): the driver
-- payout was a flat TT$32 regardless of how far the delivery actually was —
-- a driver sent 12km away from the store earned the same as one sent 1km
-- away. Rides never made this mistake (PER_KM_CENTS=175 already exists and
-- is the real, market-tested T&T per-km driving rate) — deliveries use the
-- same vehicle, same fuel, same wear, so they get the same per-km rate.
--
-- Rebalance: DELIVERY_DRIVER_PAYOUT_CENTS drops from 3200 (which blended
-- shopping + an assumed average drive into one flat number) to 2000 — now
-- representing ONLY the shopping/handling labor (~35min at a premium over
-- TT$20.50/hr minimum wage). Real driving distance is paid on top via
-- PER_KM_CENTS, reusing the existing ride rate rather than inventing a
-- second one that could drift out of sync.
--
-- Cash is NOT handled here on purpose: grocery place_order only accepts
-- payment_method IN ('card','wallet') today (grocery/index.ts:296) — cash
-- orders cannot occur, so there is nothing to branch on. If cash delivery
-- ever ships, it needs the same shadow-ledger pattern complete_ride uses
-- plus a merchant-settlement redesign, since a cash driver would be
-- collecting the merchant's cut too, not just the delivery fee — that's a
-- bigger feature than this fix.
--
-- SECOND fix bundled in here, found while adding the above: orders.
-- delivery_driver_id stores drivers.id (grocery/index.ts:479 resolves it via
-- .from('drivers').select('id').eq('user_id', user.id)) — NOT the driver's
-- auth user_id. wallet_transactions.user_id and the real payable balance
-- (SUM(amount) WHERE user_id = <auth uid>, same pattern request_driver_payout
-- uses: "SELECT user_id FROM drivers WHERE id = p_driver_id") both key off
-- the AUTH id. The original 2026-07-13 version of this function credited
-- wallet_transactions.user_id = v_order.delivery_driver_id directly — every
-- delivery payout would have been invisible in the driver's real wallet
-- balance. Never went live against a real order, caught before it could.
-- =============================================================================

UPDATE public.pricing_config
   SET value_cents = 2000,
       description = 'Base payout to the shopper/driver per completed grocery/merchant delivery — shopping/handling labor ONLY (TTD cents). Anchored to TT minimum wage TT$20.50/hr for a ~35min shop, premium over bare minimum. Driving distance is paid separately via PER_KM_CENTS (verified 2026-07-14) — this used to blend both into one flat number, which shortchanged drivers on longer deliveries.'
 WHERE key = 'DELIVERY_DRIVER_PAYOUT_CENTS';

CREATE OR REPLACE FUNCTION public.process_order_delivery_payment(p_order_id uuid, p_photo_url text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_order              RECORD;
    v_merchant            RECORD;
    v_driver_auth_id     uuid;
    v_platform_id        uuid := '00000000-0000-0000-0000-000000000000';
    v_advisory_lock_id   bigint;
    v_txn_id             uuid := gen_random_uuid();
    v_base_cents         integer;
    v_per_km_cents       integer;
    v_distance_km        numeric;
    v_distance_cents     integer;
    v_payout_cents       integer;
    v_platform_share     integer;
BEGIN
    -- Step 1: advisory lock on this order (same pattern as ride payments)
    v_advisory_lock_id := ('x' || substr(md5(p_order_id::text), 1, 16))::bit(64)::bigint;
    IF NOT pg_try_advisory_xact_lock(v_advisory_lock_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order is being processed by another request');
    END IF;

    -- Step 2: lock + validate the order
    SELECT * INTO v_order FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;
    IF v_order.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order not found');
    END IF;
    IF v_order.delivery_driver_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order has no assigned delivery driver');
    END IF;

    -- orders.delivery_driver_id is drivers.id, not the driver's auth user_id —
    -- wallet_transactions and the real payable balance both key off the auth
    -- id (same resolution request_driver_payout uses).
    SELECT user_id INTO v_driver_auth_id FROM public.drivers WHERE id = v_order.delivery_driver_id;
    IF v_driver_auth_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Driver account not found for settlement');
    END IF;

    -- Idempotency: already paid
    IF v_order.driver_payout_status = 'paid' THEN
        RETURN jsonb_build_object('success', true, 'message', 'Already paid', 'transaction_id', v_txn_id);
    END IF;

    -- First-time delivery must be in a deliverable state. A LATER call that's
    -- only submitting the proof photo to release a held payout is allowed
    -- through even though status already moved to 'delivered' on the first call.
    IF v_order.driver_payout_status = 'pending' AND v_order.status NOT IN ('confirmed', 'out_for_delivery') THEN
        RETURN jsonb_build_object('success', false, 'error', format('Cannot deliver order in %s status', v_order.status));
    END IF;

    -- Proof-of-delivery gate: no photo, no payout (holds the order as delivered
    -- but withholds pay until proof is uploaded).
    IF p_photo_url IS NULL AND v_order.delivery_photo_url IS NULL THEN
        UPDATE public.orders
           SET status = 'delivered', actual_delivery_at = COALESCE(actual_delivery_at, now()), driver_payout_status = 'held_no_proof'
         WHERE id = p_order_id;
        RETURN jsonb_build_object('success', true, 'message', 'Delivered, but payout held — no proof-of-delivery photo', 'held', true);
    END IF;

    -- Distance-based driving pay: same per-km rate rides use, computed from
    -- the actual store → dropoff distance rather than a guessed average.
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
    v_payout_cents := v_base_cents + v_distance_cents;
    v_platform_share := GREATEST(COALESCE(v_order.delivery_fee_cents, 0) - v_payout_cents, 0);

    -- Step 3: atomic settlement writes
    INSERT INTO public.wallet_transactions (id, user_id, amount, transaction_type, description, reference_id, status)
    VALUES (gen_random_uuid(), v_driver_auth_id, v_payout_cents, 'delivery_payout',
            format('Delivery payout — order %s (%s base + %s over %skm)', p_order_id::text, v_base_cents, v_distance_cents, round(v_distance_km, 1)),
            'order:' || p_order_id::text, 'completed');

    IF v_platform_share > 0 THEN
        INSERT INTO public.wallet_transactions (id, user_id, amount, transaction_type, description, reference_id, status)
        VALUES (gen_random_uuid(), v_platform_id, v_platform_share, 'delivery_fee_platform_share',
                'Delivery fee platform share — order ' || p_order_id::text, 'order:' || p_order_id::text, 'completed');
    END IF;

    -- log_platform_revenue has TWO overloads (6-arg and 7-arg with
    -- p_reserve_cents) — must call the full 7-arg form explicitly or
    -- Postgres cannot resolve which one to use.
    PERFORM public.log_platform_revenue(
        p_ride_id := NULL::uuid, p_order_id := p_order_id, p_merchant_id := v_order.merchant_id,
        p_gross_cents := COALESCE(v_order.delivery_fee_cents, 0), p_payout_cents := v_payout_cents,
        p_merchant_earnings_cents := 0, p_reserve_cents := 0
    );

    UPDATE public.orders
       SET status = 'delivered',
           actual_delivery_at = COALESCE(actual_delivery_at, now()),
           driver_paid_cents = v_payout_cents,
           driver_payout_status = 'paid',
           delivery_photo_url = COALESCE(p_photo_url, v_order.delivery_photo_url)
     WHERE id = p_order_id;

    RETURN jsonb_build_object(
        'success', true, 'transaction_id', v_txn_id, 'driver_payout_cents', v_payout_cents,
        'base_cents', v_base_cents, 'distance_km', round(v_distance_km, 2), 'distance_cents', v_distance_cents
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.process_order_delivery_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_order_delivery_payment(uuid, text) TO authenticated, service_role;
