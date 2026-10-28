-- =============================================================================
-- Shop system economics (founder direction, 2026-10-28).
--
-- The promise a shop hears (from the OrderFlow reel Taylor adopted):
-- "Your own system inside G: the order rings in your kitchen, your
-- customer stays YOUR customer, no commission on your own orders."
-- This migration makes the money match that promise:
--
--   1. ORDER CHANNEL. orders.order_channel marks where an order came
--      from: 'direct' (the shop's own customer — their link, QR, tap
--      point or regular) or 'marketplace' (G found this customer).
--      Existing rows default to 'marketplace'; the apps set 'direct'
--      at creation when the order enters through the shop's own
--      surface. Old app versions keep working (column default).
--
--   2. GOODS COMMISSION BY CHANNEL (calculate_delivery_merchant_cut).
--      Direct orders: 0% — the platform takes nothing from the goods
--      on a shop's own customer. Marketplace orders (G brought the
--      buyer): grocery/pharmacy 5%, restaurant 10%, other 8% of the
--      goods subtotal. Replaces the flat 15% on everything
--      (PLATFORM_RATE_CENTS_DELIVERY, kept as a legacy key, no longer
--      read by the cut function). The platform earns on direct
--      orders from the delivery leg + the shop's subscription, not
--      from the shop's till.
--
--   3. DELIVERY FEE PRICED LIKE A RIDE, SET BY THE SERVER.
--      compute_delivery_fee_cents() = TT$25 base + TT$2.25/km, set by
--      a BEFORE INSERT trigger on orders (the client's fee is
--      replaced; total_cents is adjusted by the difference so the
--      goods subtotal never moves). The shopper/driver is paid
--      TT$20 + TT$1.75/km (existing keys); the platform keeps
--      TT$5 + TT$0.50/km for dispatch, support and SOS. A merchant
--      can no longer zero the fee and leave the leg unfunded.
--
--   4. FUEL AWARENESS (the system watches fluctuating costs).
--      FUEL_PRICE_CENTS is the current price of super per litre
--      (admin-maintained in pricing_config, seeded at today's
--      TT$5.97). Every full TT$0.50/L step above the baseline adds
--      TT$0.10/km to BOTH the customer price (rides via
--      estimate_fare, deliveries via compute_delivery_fee_cents)
--      and the driver/shopper payout per km — fuel rises pass
--      through by published rule, never out of the driver's pocket
--      and never out of the platform margin. fuel_per_km_adjustment
--      _cents() is the single helper both sides use.
--
--   5. PROMOTIONS: NO DOUBLE-CHARGING, AND THE MONEY ACTUALLY MOVES.
--      charge_promotion_impression() previously charged a shop
--      TT$0.50 every time the same rider re-opened the map, and the
--      "spend" was only a counter — no wallet was ever debited, so
--      the platform collected nothing. Now: one charge per rider
--      per promotion per day (repeat views are recorded at TT$0 so
--      reach still counts in the shop's proof report), and every
--      charge writes a wallet debit to the merchant owner and a
--      matching credit to the platform, same ledger shape as the
--      cancellation fee.
--
-- Safe to run ahead of app updates: every behaviour change keys off
-- columns/keys with defaults that match today's flow, except the
-- delivery-fee trigger and the promo collection, which fix leaks
-- that are live today.
-- =============================================================================

-- ── 1. Order channel ─────────────────────────────────────────────────────────
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS order_channel text NOT NULL DEFAULT 'marketplace';

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_order_channel_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_order_channel_check
    CHECK (order_channel IN ('direct', 'marketplace'));

-- ── 2. Pricing keys ──────────────────────────────────────────────────────────
INSERT INTO public.pricing_config (key, value_cents, description) VALUES
    ('GOODS_COMMISSION_DIRECT_BPS', 0,
     'Commission on goods for DIRECT orders (the shop''s own customer) in basis points. 0 = the platform takes nothing from the goods; it earns on the delivery leg and the subscription.'),
    ('GOODS_COMMISSION_GROCERY_BPS', 500,
     'Commission on goods for MARKETPLACE orders at grocery/pharmacy shops (G found the customer), basis points of the goods subtotal. Thin grocery margins cap this at 5%.'),
    ('GOODS_COMMISSION_RESTAURANT_BPS', 1000,
     'Commission on goods for MARKETPLACE orders at restaurants, basis points of the goods subtotal.'),
    ('GOODS_COMMISSION_DEFAULT_BPS', 800,
     'Commission on goods for MARKETPLACE orders at all other store types, basis points of the goods subtotal.'),
    ('DELIVERY_FEE_BASE_CENTS', 2500,
     'Customer delivery fee base (TTD cents): TT$20 shopper/driver labour pass-through + TT$5 platform. Distance is added per km on top. Server-set at order creation; merchants cannot discount it to zero.'),
    ('DELIVERY_FEE_PER_KM_CENTS', 225,
     'Customer delivery fee per km (TTD cents): TT$1.75 to the shopper/driver + TT$0.50 platform. The fuel adjustment is added on top of this for the customer AND the driver alike.'),
    ('FUEL_PRICE_CENTS', 597,
     'Current price of super gasoline per litre (TTD cents). Admin updates this when the pump price moves; the fuel escalator reads it. Seeded at TT$5.97 (28 Oct 2026).'),
    ('FUEL_BASELINE_CENTS', 597,
     'Fuel price the published fares were built on (TTD cents per litre). The escalator only adds above this line; it never subtracts below it.'),
    ('FUEL_STEP_CENTS', 50,
     'Fuel escalator step: each full rise of this many cents per litre above the baseline triggers one per-km step.'),
    ('FUEL_STEP_PER_KM_CENTS', 10,
     'Fuel escalator size: cents per km added to customer price AND driver payout for each fuel step above baseline.')
ON CONFLICT (key) DO NOTHING;

-- ── 3. Fuel helper ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fuel_per_km_adjustment_cents()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_price    integer := COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'FUEL_PRICE_CENTS'), 597);
    v_baseline integer := COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'FUEL_BASELINE_CENTS'), 597);
    v_step     integer := COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'FUEL_STEP_CENTS'), 50);
    v_per_km   integer := COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'FUEL_STEP_PER_KM_CENTS'), 10);
BEGIN
    IF v_step IS NULL OR v_step <= 0 THEN
        RETURN 0;
    END IF;
    RETURN GREATEST(0, FLOOR((v_price - v_baseline)::numeric / v_step)::integer) * v_per_km;
END;
$$;
REVOKE ALL ON FUNCTION public.fuel_per_km_adjustment_cents() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fuel_per_km_adjustment_cents() TO authenticated, service_role;

-- ── 4. Merchant cut by channel + store type ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_delivery_merchant_cut(p_order_id uuid)
RETURNS TABLE(goods_subtotal_cents integer, merchant_cut_cents integer, platform_cut_cents integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_order         RECORD;
    v_bps           integer;
    v_subtotal      integer;
    v_platform_cut  integer;
BEGIN
    SELECT o.total_cents, o.delivery_fee_cents, o.order_channel, m.store_type
      INTO v_order
      FROM public.orders o
      LEFT JOIN public.merchants m ON m.id = o.merchant_id
     WHERE o.id = p_order_id;

    v_subtotal := GREATEST(COALESCE(v_order.total_cents, 0) - COALESCE(v_order.delivery_fee_cents, 0), 0);

    IF v_order.order_channel = 'direct' THEN
        v_bps := COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'GOODS_COMMISSION_DIRECT_BPS'), 0);
    ELSIF v_order.store_type IN ('grocery', 'pharmacy') THEN
        v_bps := COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'GOODS_COMMISSION_GROCERY_BPS'), 500);
    ELSIF v_order.store_type = 'restaurant' THEN
        v_bps := COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'GOODS_COMMISSION_RESTAURANT_BPS'), 1000);
    ELSE
        v_bps := COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'GOODS_COMMISSION_DEFAULT_BPS'), 800);
    END IF;

    v_platform_cut := ROUND(v_subtotal * v_bps / 10000.0)::integer;

    RETURN QUERY SELECT v_subtotal, v_subtotal - v_platform_cut, v_platform_cut;
END;
$$;
REVOKE ALL ON FUNCTION public.calculate_delivery_merchant_cut(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_delivery_merchant_cut(uuid) TO authenticated, service_role;

-- ── 5. Driver/shopper payout: fuel adjustment added per km ───────────────────
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
    v_per_km_cents := COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'PER_KM_CENTS'), 175)
                      + public.fuel_per_km_adjustment_cents();

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

-- ── 6. Server-set delivery fee (priced like a ride) ──────────────────────────
CREATE OR REPLACE FUNCTION public.compute_delivery_fee_cents(
    p_merchant_id uuid,
    p_delivery_lat double precision,
    p_delivery_lng double precision
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_merchant     RECORD;
    v_base_cents   integer := COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'DELIVERY_FEE_BASE_CENTS'), 2500);
    v_per_km_cents integer := COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'DELIVERY_FEE_PER_KM_CENTS'), 225)
                              + public.fuel_per_km_adjustment_cents();
    v_distance_km  numeric := 0;
BEGIN
    IF p_merchant_id IS NOT NULL AND p_delivery_lat IS NOT NULL AND p_delivery_lng IS NOT NULL THEN
        SELECT lat, lng INTO v_merchant FROM public.merchants WHERE id = p_merchant_id;
        IF v_merchant.lat IS NOT NULL AND v_merchant.lng IS NOT NULL THEN
            v_distance_km := ST_DistanceSphere(
                ST_MakePoint(v_merchant.lng, v_merchant.lat),
                ST_MakePoint(p_delivery_lng, p_delivery_lat)
            ) / 1000.0;
        END IF;
    END IF;

    RETURN v_base_cents + ROUND(v_distance_km * v_per_km_cents)::integer;
END;
$$;
REVOKE ALL ON FUNCTION public.compute_delivery_fee_cents(uuid, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_delivery_fee_cents(uuid, double precision, double precision) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_order_delivery_fee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_new_fee integer;
BEGIN
    IF NEW.delivery_method = 'courier'
       AND NEW.merchant_id IS NOT NULL
       AND NEW.delivery_lat IS NOT NULL
       AND NEW.delivery_lng IS NOT NULL THEN
        v_new_fee := public.compute_delivery_fee_cents(NEW.merchant_id, NEW.delivery_lat, NEW.delivery_lng);
        -- Swap the fee inside the total so the goods subtotal (total - fee)
        -- is exactly what the customer agreed to pay for the goods.
        NEW.total_cents := GREATEST(COALESCE(NEW.total_cents, 0) - COALESCE(NEW.delivery_fee_cents, 0), 0) + v_new_fee;
        NEW.delivery_fee_cents := v_new_fee;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_order_delivery_fee ON public.orders;
CREATE TRIGGER trg_set_order_delivery_fee
    BEFORE INSERT ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.set_order_delivery_fee();

-- ── 7. Promotions: dedup per rider/day + real wallet collection ──────────────
CREATE OR REPLACE FUNCTION public.charge_promotion_impression(
    p_promotion_id uuid,
    p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_promo public.merchant_promotions;
    v_cost  integer;
    v_owner uuid;
    v_platform_id uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
    SELECT * INTO v_promo FROM public.merchant_promotions WHERE id = p_promotion_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN false;
    END IF;
    IF NOT v_promo.is_active OR current_date < v_promo.start_date OR current_date > v_promo.end_date THEN
        RETURN false;
    END IF;

    -- One charge per rider per promotion per day. A repeat view is
    -- recorded at TT$0 so the shop's reach numbers stay honest,
    -- but the shop is never charged twice for the same eyeballs.
    IF EXISTS (
        SELECT 1 FROM public.promotion_impressions
        WHERE promotion_id = p_promotion_id
          AND user_id = p_user_id
          AND impression_type = 'view'
          AND cost_charged_cents > 0
          AND created_at >= CURRENT_DATE
    ) THEN
        INSERT INTO public.promotion_impressions (promotion_id, user_id, impression_type, cost_charged_cents)
        VALUES (p_promotion_id, p_user_id, 'view', 0);
        RETURN true;
    END IF;

    v_cost := v_promo.cost_per_impression_cents;

    IF v_promo.spent_cents + v_cost > v_promo.budget_cents THEN
        -- Would exceed budget — refuse the impression and pause now,
        -- rather than overspending and pausing on the NEXT check.
        UPDATE public.merchant_promotions SET is_active = false, updated_at = now() WHERE id = p_promotion_id;
        RETURN false;
    END IF;

    INSERT INTO public.promotion_impressions (promotion_id, user_id, impression_type, cost_charged_cents)
    VALUES (p_promotion_id, p_user_id, 'view', v_cost);

    UPDATE public.merchant_promotions
    SET spent_cents = spent_cents + v_cost,
        is_active = (spent_cents + v_cost < budget_cents),
        updated_at = now()
    WHERE id = p_promotion_id;

    -- Collect it. Until now spent_cents was only a counter and no
    -- money ever moved; debit the merchant owner and credit the
    -- platform in the same ledger shape as the cancellation fee.
    SELECT created_by INTO v_owner FROM public.merchants WHERE id = v_promo.merchant_id;
    IF v_owner IS NOT NULL AND v_cost > 0 THEN
        INSERT INTO public.wallet_transactions (id, user_id, amount, transaction_type, description, reference_id, status)
        VALUES
            (gen_random_uuid(), v_owner, -v_cost, 'promotion_charge',
             'Promotion view charge — promotion ' || p_promotion_id::text,
             'promotion:' || p_promotion_id::text, 'completed'),
            (gen_random_uuid(), v_platform_id, v_cost, 'promotion_charge',
             'Promotion view collected — promotion ' || p_promotion_id::text,
             'promotion:' || p_promotion_id::text, 'completed');
    END IF;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.charge_promotion_impression(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.charge_promotion_impression(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
