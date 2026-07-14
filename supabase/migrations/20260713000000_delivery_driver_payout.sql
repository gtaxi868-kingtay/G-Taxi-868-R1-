-- =============================================================================
-- Delivery driver payout — closes a real gap found 2026-07-13: orders track
-- merchant_paid_cents but have NO equivalent payout mechanism for the driver
-- who actually shops/drives the delivery, and no endpoint ever marks an order
-- "delivered" at all. This mirrors the proven ride settlement pattern
-- (process_wallet_payment_hardened): advisory lock, idempotency check, atomic
-- multi-row wallet_transactions insert, ledger write.
--
-- Payout is a FLAT per-delivery amount, anchored to T&T minimum wage
-- (TT$20.50/hr, Jan 2024 rate) for a realistic ~50-min shop+drive job, not a
-- percentage of gross like rides — a grocery run's effort doesn't scale with
-- cart value the way a ride's effort scales with distance.
--
-- Verified end-to-end against a real test order (both the held-no-proof path
-- and the photo-submitted paid path) before this file was finalized.
-- =============================================================================

-- 1. Order columns for delivery completion + driver payout tracking ----------
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS driver_paid_cents integer DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS driver_payout_status text NOT NULL DEFAULT 'pending'
  CHECK (driver_payout_status IN ('pending', 'held_no_proof', 'paid'));
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_photo_url text;

-- 2. Pricing config: minimum-wage-anchored delivery payout floor -------------
INSERT INTO public.pricing_config (key, value_cents, description) VALUES
  ('DELIVERY_DRIVER_PAYOUT_CENTS', 3200,
   'Flat payout to the shopper/driver per completed grocery/merchant delivery (TTD cents). Anchored to TT minimum wage TT$20.50/hr for a realistic ~50min shop+drive job (verified 2026-07-13) — NOT a percentage split like rides, a delivery''s effort does not scale with cart value.')
ON CONFLICT (key) DO NOTHING;

-- 3. wallet_transactions.transaction_type CHECK was a fixed enum that
--    rejected the two new types below (same silent-rejection trap as
--    agent_decision_log's old constraint) — extend rather than reuse a
--    differently-scoped existing type.
ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_transaction_type_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_transaction_type_check
  CHECK (transaction_type = ANY (ARRAY['topup','ride_payment','refund','bonus','driver_payout','tip','commission_fee',
    'cancellation_fee','leakage_fine','debt_recovery','payout','debt_repayment','lease_deduction','lease_income',
    'capital_reserve','merchant_commission','travel_package_payment','travel_package_refund','scout_referral_payout',
    'referral_bonus','merchant_subscription','merchant_purchase','delivery_payout','delivery_fee_platform_share']));

-- 4. Settlement RPC: mirrors process_wallet_payment_hardened's rigor ---------
CREATE OR REPLACE FUNCTION public.process_order_delivery_payment(p_order_id uuid, p_photo_url text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_order              RECORD;
    v_platform_id        uuid := '00000000-0000-0000-0000-000000000000';
    v_advisory_lock_id   bigint;
    v_txn_id             uuid := gen_random_uuid();
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

    v_payout_cents := COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'DELIVERY_DRIVER_PAYOUT_CENTS'), 3200);
    v_platform_share := GREATEST(COALESCE(v_order.delivery_fee_cents, 0) - v_payout_cents, 0);

    -- Step 3: atomic settlement writes
    INSERT INTO public.wallet_transactions (id, user_id, amount, transaction_type, description, reference_id, status)
    VALUES (gen_random_uuid(), v_order.delivery_driver_id, v_payout_cents, 'delivery_payout',
            'Delivery payout — order ' || p_order_id::text, 'order:' || p_order_id::text, 'completed');

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

    RETURN jsonb_build_object('success', true, 'transaction_id', v_txn_id, 'driver_payout_cents', v_payout_cents);
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.process_order_delivery_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_order_delivery_payment(uuid, text) TO authenticated, service_role;
