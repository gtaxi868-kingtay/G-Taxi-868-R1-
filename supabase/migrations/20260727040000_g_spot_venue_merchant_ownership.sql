-- ═══════════════════════════════════════════════════════════════════
-- G SPOT VENUES: REAL MERCHANT OWNERSHIP (2026-07-27)
--
-- g_spot_venues had no merchant_id at all — built as an admin-only
-- construct disconnected from the real merchants table (which already
-- has a working owner-login system: apps/merchant, created_by, the
-- whole merchant_signup/merchant_register_with_code flow). That meant
-- redemption could only ever be admin-operated — not a venue-staff
-- problem, an ownership-model problem underneath it.
--
-- Fix: link a venue to a real merchant account (nullable — existing
-- admin-created venues have no real owner yet, and that's the honest
-- state, not something to fake). Once linked, the venue's OWNER
-- redeems codes from the merchant app they already log into — the
-- same app used for grocery/food/appointments — not a separate app,
-- not admin.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.g_spot_venues
    ADD COLUMN IF NOT EXISTS merchant_id uuid REFERENCES public.merchants(id);

CREATE INDEX IF NOT EXISTS idx_g_spot_venues_merchant_id ON public.g_spot_venues(merchant_id);

-- Merchant owner can read/redeem for their own venue.
DROP POLICY IF EXISTS "Merchant reads own venue" ON public.g_spot_venues;
CREATE POLICY "Merchant reads own venue" ON public.g_spot_venues
    FOR SELECT USING (
        status = 'active'
        OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
        OR EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = merchant_id AND m.created_by = (SELECT auth.uid()))
    );
DROP POLICY IF EXISTS "Read venues" ON public.g_spot_venues;

-- Real single source of truth for redemption, callable by either the
-- admin panel (oversight/fallback) or the merchant app (the actual
-- venue owner) — same underlying cap logic either way, just two
-- different authorization paths into the same function.
CREATE OR REPLACE FUNCTION public.merchant_redeem_g_spot_code(
    p_code text,
    p_discount_cents integer,
    p_merchant_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_merchant   public.merchants;
    v_code_row   public.g_spot_redeem_codes;
    v_venue_id   uuid;
    v_membership public.g_spot_memberships;
BEGIN
    SELECT * INTO v_merchant FROM public.merchants WHERE created_by = p_merchant_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Not a registered merchant';
    END IF;
    IF p_discount_cents IS NULL OR p_discount_cents < 0 THEN
        RAISE EXCEPTION 'p_discount_cents must be >= 0';
    END IF;

    SELECT * INTO v_code_row FROM public.g_spot_redeem_codes
    WHERE code = upper(p_code) AND status = 'active' AND expires_at > now()
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Code not found, already used, or expired';
    END IF;

    SELECT venue_id INTO v_venue_id FROM public.g_spot_memberships WHERE id = v_code_row.membership_id;
    IF NOT EXISTS (SELECT 1 FROM public.g_spot_venues WHERE id = v_venue_id AND merchant_id = v_merchant.id) THEN
        RAISE EXCEPTION 'This code is not for your venue';
    END IF;

    v_membership := public.g_spot_redeem_drink_subsidy(v_code_row.membership_id, p_discount_cents);

    UPDATE public.g_spot_redeem_codes
    SET status = 'redeemed', redeemed_at = now(), redeemed_by = p_merchant_user_id,
        discount_cents_applied = p_discount_cents
    WHERE id = v_code_row.id;

    RETURN jsonb_build_object(
        'membership_id', v_membership.id,
        'drink_subsidy_used_cents', v_membership.drink_subsidy_used_cents,
        'drink_subsidy_cap_cents', v_membership.drink_subsidy_cap_cents
    );
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_redeem_g_spot_code(text, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merchant_redeem_g_spot_code(text, integer, uuid) TO service_role;

-- redeemed_by references profiles(id); a merchant owner authenticates
-- as a real auth user whose id already has a profiles row (every
-- signed-up user does), so this FK holds for either redeemer path.

NOTIFY pgrst, 'reload schema';
