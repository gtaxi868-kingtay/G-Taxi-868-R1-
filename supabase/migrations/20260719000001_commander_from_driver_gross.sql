-- Migration: 20260719000001_commander_from_driver_gross.sql
-- Description: Commander cut is 2% of GROSS, deducted from the driver's payout.
-- Taxi fares are VAT-exempt in T&T (Value Added Tax Act, Schedule 1).
-- No VAT carve-out exists anywhere in this system.
-- The platform keeps its full 15%. The commander's 2% comes from the driver's 82%.

CREATE OR REPLACE FUNCTION "public"."record_pool_entry"("p_ride_id" "uuid", "p_gross_cents" bigint, "p_platform_cents" bigint DEFAULT 0, "p_reserve_cents" bigint DEFAULT 0) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_territory_id    uuid;
    v_driver_id       uuid;
    v_driver_user_id  uuid;
    v_commander_id    uuid;
    v_merchant_id     uuid;
    v_referrer_id     uuid;
    v_platform_fee    bigint;
    v_comm_share      bigint;
    v_merch_share     bigint;
    v_ref_share       bigint;
    v_plat_share      bigint;
BEGIN
    IF p_ride_id IS NULL OR COALESCE(p_gross_cents, 0) <= 0 THEN
        RETURN;
    END IF;

    -- Idempotency: skip if already recorded
    IF EXISTS (SELECT 1 FROM public.ecosystem_pool_ledger WHERE ride_id = p_ride_id) THEN
        RETURN;
    END IF;

    SELECT territory_id, driver_id INTO v_territory_id, v_driver_id
    FROM public.rides WHERE id = p_ride_id;

    -- Resolve the driver's auth user_id to find their commander
    IF v_driver_id IS NOT NULL THEN
        SELECT user_id INTO v_driver_user_id
        FROM public.drivers WHERE id = v_driver_id;

        IF v_driver_user_id IS NOT NULL THEN
            SELECT referred_by_commander_id INTO v_commander_id
            FROM public.profiles
            WHERE id = v_driver_user_id;
        END IF;
    END IF;

    BEGIN
        SELECT m.created_by INTO v_merchant_id
        FROM public.rides r
        JOIN public.merchants m ON m.id = r.billed_to_merchant_id
        WHERE r.id = p_ride_id;
    EXCEPTION WHEN others THEN
        v_merchant_id := NULL;
    END;

    BEGIN
        SELECT referrer_user_id INTO v_referrer_id
        FROM public.driver_referrals
        WHERE referred_driver_id = v_driver_id
        LIMIT 1;
    EXCEPTION WHEN others THEN
        v_referrer_id := NULL;
    END;

    -- No VAT. Taxi fares are exempt in T&T.
    -- Platform gets 15% of gross.
    v_platform_fee := ROUND(p_gross_cents * 0.15);

    -- Commander gets 2% of gross, sourced from the driver's payout (not from the platform).
    IF v_commander_id IS NOT NULL THEN
        v_comm_share := ROUND(p_gross_cents * 0.02);
    ELSE
        v_comm_share := 0;
    END IF;

    -- Platform shares its fee internally with merchant and referral (if applicable).
    v_merch_share := ROUND(v_platform_fee * 0.133);
    v_ref_share   := ROUND(v_platform_fee * 0.133);
    v_plat_share  := v_platform_fee - v_merch_share - v_ref_share;

    -- Insert standard ecosystem splits
    INSERT INTO public.ecosystem_pool_ledger (ride_id, beneficiary_type, beneficiary_id, pct, gross_cents, amount_cents)
    VALUES
        (p_ride_id, 'platform', NULL,          ROUND(v_plat_share::numeric / NULLIF(p_gross_cents, 0) * 100, 2), p_gross_cents, v_plat_share),
        (p_ride_id, 'merchant', v_merchant_id,  ROUND(v_merch_share::numeric / NULLIF(p_gross_cents, 0) * 100, 2), p_gross_cents, v_merch_share),
        (p_ride_id, 'referral', v_referrer_id,  ROUND(v_ref_share::numeric   / NULLIF(p_gross_cents, 0) * 100, 2), p_gross_cents, v_ref_share)
    ON CONFLICT (ride_id, beneficiary_type) DO NOTHING;

    -- Commander is a standalone entry sourced from the driver, not from the platform fee.
    IF v_commander_id IS NOT NULL AND v_comm_share > 0 THEN
        INSERT INTO public.ecosystem_pool_ledger (ride_id, beneficiary_type, beneficiary_id, pct, gross_cents, amount_cents)
        VALUES
            (p_ride_id, 'commander', v_commander_id, 2.00, p_gross_cents, v_comm_share)
        ON CONFLICT (ride_id, beneficiary_type) DO NOTHING;
    END IF;

END;
$$;
