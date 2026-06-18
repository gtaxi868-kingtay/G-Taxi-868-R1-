-- Migration: 20260617000004_per_vertical_platform_rates
-- Seeds per-vertical platform rate keys into pricing_config so admin
-- can set different commission % per vertical via the admin panel.
-- Also updates process_cash_delivery_settlement to read live from config.

BEGIN;

-- ── 1. Seed per-vertical platform rate keys ────────────────────────────
-- Each vertical gets its own key so the admin panel can show them grouped.
-- Existing PLATFORM_RATE_CENTS (1900 = 19%) stays as the ride-specific key.
INSERT INTO public.pricing_config (key, value_cents, description) VALUES
    ('PLATFORM_RATE_CENTS_RIDE',     1900, 'Platform commission on rides (1900 = 19%)'),
    ('PLATFORM_RATE_CENTS_GROCERY',  1800, 'Platform commission on grocery delivery (1800 = 18%)'),
    ('PLATFORM_RATE_CENTS_LAUNDRY',  1800, 'Platform commission on laundry services (1800 = 18%)'),
    ('PLATFORM_RATE_CENTS_TRAVEL',   1500, 'Platform commission on G-Escape travel (1500 = 15%)'),
    ('PLATFORM_RATE_CENTS_DELIVERY', 1900, 'Platform commission on merchant delivery (1900 = 19%)'),
    ('PLATFORM_RATE_CENTS_FOOD',     2000, 'Platform commission on food delivery (2000 = 20%)'),
    ('PLATFORM_RATE_CENTS_B2B',      1500, 'Platform commission on B2B logistics (1500 = 15%)')
ON CONFLICT (key) DO UPDATE
    SET value_cents = EXCLUDED.value_cents,
        description = EXCLUDED.description,
        updated_at  = now();

-- ── 2. Update process_cash_delivery_settlement — read from pricing_config ──
-- Replaces hardcoded v_platform_rate := 0.19 with live lookup.
-- Falls back to 0.19 if config key is missing.
CREATE OR REPLACE FUNCTION public.process_cash_delivery_settlement(
    p_order_id UUID,
    p_driver_user_id UUID,
    p_merchant_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order RECORD;
    v_merchant_owner_id UUID;
    v_merchant_cut_cents INTEGER;
    v_plat_cents INTEGER;
    v_platform_rate NUMERIC;
BEGIN
    -- Lock the order row
    SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order not found');
    END IF;

    IF v_order.payment_status != 'cash_on_delivery' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order is not cash-on-delivery');
    END IF;

    IF v_order.merchant_payout_status = 'paid' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Already settled');
    END IF;

    -- Read platform rate from pricing_config; fallback to 1900 (19%)
    SELECT value_cents INTO v_plat_cents
    FROM public.pricing_config
    WHERE key = 'PLATFORM_RATE_CENTS_DELIVERY';
    v_platform_rate := COALESCE(v_plat_cents, 1900) / 10000.0;

    -- Merchant gets (1 - platform_rate) of total
    v_merchant_cut_cents := round(v_order.total_cents * (1 - v_platform_rate));

    -- Get merchant owner user_id
    SELECT created_by INTO v_merchant_owner_id FROM merchants WHERE id = p_merchant_id;

    IF v_merchant_owner_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Merchant has no owner');
    END IF;

    -- Credit merchant wallet
    INSERT INTO wallet_transactions (user_id, order_id, amount, transaction_type, description, status)
    VALUES (v_merchant_owner_id, p_order_id, v_merchant_cut_cents, 'merchant_commission',
            'Cash delivery settlement -- order ' || p_order_id::text, 'completed');

    INSERT INTO wallets (user_id, balance_cents)
    VALUES (v_merchant_owner_id, v_merchant_cut_cents)
    ON CONFLICT (user_id)
    DO UPDATE SET balance_cents = wallets.balance_cents + v_merchant_cut_cents;

    -- Mark order settled
    UPDATE orders SET
        merchant_payout_status = 'paid',
        merchant_paid_cents = v_merchant_cut_cents,
        merchant_paid_at = now(),
        cash_collected = true,
        cash_collected_at = now()
    WHERE id = p_order_id;

    -- Log to platform revenue
    INSERT INTO platform_revenue_logs (order_id, merchant_id, gross_cents, platform_fee_cents, merchant_split_cents)
    VALUES (p_order_id, p_merchant_id, v_order.total_cents,
            v_order.total_cents - v_merchant_cut_cents, v_merchant_cut_cents);

    -- Deduct driver wallet (driver keeps cash, so balance decreases by commission)
    INSERT INTO wallet_transactions (user_id, order_id, amount, transaction_type, description, status)
    VALUES (p_driver_user_id, p_order_id, -(v_order.total_cents - v_merchant_cut_cents), 'commission_fee',
            'Platform fee on cash delivery -- driver collected ' || (v_order.total_cents / 100)::text || ' TTD cash', 'completed');

    RETURN jsonb_build_object(
        'success', true,
        'merchant_credited_cents', v_merchant_cut_cents,
        'platform_fee_cents', v_order.total_cents - v_merchant_cut_cents,
        'merchant_owner', v_merchant_owner_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_cash_delivery_settlement(UUID, UUID, UUID) TO service_role;

-- ── 3. Add admin_get_platform_rates RPC (for the dedicated admin UI section) ──
-- Returns only the PLATFORM_RATE_CENTS_* keys grouped by vertical.
CREATE OR REPLACE FUNCTION public.admin_get_platform_rates()
RETURNS TABLE (key TEXT, value_cents INTEGER, description TEXT)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT key, value_cents, description
    FROM public.pricing_config
    WHERE key LIKE 'PLATFORM_RATE_CENTS\_%'
    ORDER BY key;
$$;

REVOKE ALL ON FUNCTION public.admin_get_platform_rates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_platform_rates() TO service_role, authenticated;

COMMIT;
