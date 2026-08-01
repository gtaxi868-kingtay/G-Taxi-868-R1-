-- ═══════════════════════════════════════════════════════════════════
-- MERCHANT PROMOTIONS: REAL RIDER-FACING CONSUMPTION (2026-07-27)
--
-- Before this: a merchant could create a promotion, an admin could
-- approve it (is_active=true), and NOTHING would ever read that flag —
-- confirmed by grep, zero rider-facing code touched merchant_promotions
-- anywhere. A merchant paying a budget would get literally nothing.
--
-- This wires the one real rider-facing surface that already exists for
-- 'suggested_stop'/'map_pin' promotion types: get_nearby_merchants
-- (already used to suggest a merchant stop along a ride route). Matching
-- active promotions get boosted to the front of the list, and each time
-- a rider actually sees one, a real impression is billed against the
-- promotion's own budget — auto-pausing the promotion the moment it
-- would exceed budget_cents, not after.
-- ═══════════════════════════════════════════════════════════════════

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
BEGIN
    SELECT * INTO v_promo FROM public.merchant_promotions WHERE id = p_promotion_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN false;
    END IF;
    IF NOT v_promo.is_active OR current_date < v_promo.start_date OR current_date > v_promo.end_date THEN
        RETURN false;
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

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.charge_promotion_impression(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.charge_promotion_impression(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
