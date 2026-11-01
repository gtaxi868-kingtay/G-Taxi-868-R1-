-- Merchant ad-space subscription (founder decision 2026-09-26, via artifact
-- comment thread): the old $500 commander application buy-in is retired
-- (commander applications are free -- see BecomeCommanderScreen.tsx fix,
-- same date). The $500 moves here: a merchant pays it once for 30 days of
-- featured/promoted placement. A merchant who refers another merchant into
-- buying ad space earns a cut of that purchase.
--
-- Deliberately its own table, not merchant_subscriptions -- that table is
-- the ongoing pin-fee/counter-placement relationship (90-day trial then
-- TTD 150/mo). This is a separate, time-boxed promotional purchase with a
-- different lifecycle (one-time payment, fixed 30-day window, no trial).
--
-- Referral mechanism deliberately does NOT reuse referral_codes/type='merchant'
-- (that's already the driver-refers-merchant-at-signup program, paid via
-- apply_referral_code's flat $15 bonus -- a different reward shape and a
-- different referee relationship). Reusing it here would mean two distinct
-- reward programs sharing one code namespace under one type. Instead: a
-- direct, dedicated referral code per merchant, since the cut is a
-- percentage of a specific $500 purchase, not a flat signup bonus.
--
-- Payment collection: real charging goes through WiPay (matching every
-- other card-payment path here) -- but WIPAY_ACCOUNT_NUMBER/WIPAY_API_KEY
-- are not configured in this environment (per CLAUDE.md), so the actual
-- purchase edge function will correctly return the same 'coming_soon' every
-- other WiPay-gated feature does until those keys are set. This migration
-- builds the money-correct data model and activation logic ahead of that,
-- same pattern already used for G-Member.

ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS ad_referral_code text UNIQUE;

CREATE TABLE IF NOT EXISTS public.merchant_ad_placements (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id             uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    referred_by_merchant_id uuid REFERENCES public.merchants(id) ON DELETE SET NULL,
    amount_cents            integer NOT NULL DEFAULT 50000,
    referral_cut_cents      integer,
    status                  text NOT NULL DEFAULT 'pending_payment'
                            CHECK (status IN ('pending_payment', 'active', 'expired', 'cancelled')),
    wipay_transaction_id    text,
    starts_at               timestamptz,
    expires_at              timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now(),
    activated_at            timestamptz
);

CREATE INDEX IF NOT EXISTS idx_merchant_ad_placements_merchant
    ON public.merchant_ad_placements(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_ad_placements_active
    ON public.merchant_ad_placements(status, expires_at)
    WHERE status = 'active';

ALTER TABLE public.merchant_ad_placements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Merchant reads own ad placements" ON public.merchant_ad_placements
    FOR SELECT USING (
        merchant_id IN (SELECT id FROM public.merchants WHERE created_by = auth.uid())
    );

-- Referral cut percentage, config-driven per this project's own rule against
-- hardcoding splits directly in code. Default 10% of the $500 purchase.
INSERT INTO public.pricing_config (key, value_cents)
VALUES ('MERCHANT_AD_REFERRAL_CUT_BPS', 1000)
ON CONFLICT (key) DO NOTHING;

-- Generates (or returns the existing) shareable ad-referral code for a
-- merchant -- a plain unique short code on the merchants row itself, not a
-- referral_codes entry (see header comment for why).
CREATE OR REPLACE FUNCTION public.get_or_create_merchant_ad_referral_code(p_merchant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_code text;
    v_attempts int := 0;
BEGIN
    SELECT ad_referral_code INTO v_code FROM public.merchants WHERE id = p_merchant_id;
    IF v_code IS NOT NULL THEN
        RETURN v_code;
    END IF;

    LOOP
        v_code := upper(substring(md5(p_merchant_id::text || clock_timestamp()::text) FROM 1 FOR 6));
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.merchants WHERE ad_referral_code = v_code);
        v_attempts := v_attempts + 1;
        IF v_attempts > 20 THEN RAISE EXCEPTION 'Could not generate a unique ad-referral code'; END IF;
    END LOOP;

    UPDATE public.merchants SET ad_referral_code = v_code WHERE id = p_merchant_id;
    RETURN v_code;
END;
$function$;

-- Creates the pending placement and resolves an optional referral code to
-- the referring merchant. Does NOT collect payment or activate anything --
-- that happens in activate_merchant_ad_placement once a real charge (WiPay)
-- confirms. A merchant cannot refer themselves.
CREATE OR REPLACE FUNCTION public.request_merchant_ad_placement(
    p_merchant_id uuid,
    p_referral_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_referrer_merchant_id uuid;
    v_placement_id uuid;
BEGIN
    IF p_referral_code IS NOT NULL AND length(trim(p_referral_code)) > 0 THEN
        SELECT id INTO v_referrer_merchant_id
        FROM public.merchants
        WHERE ad_referral_code = upper(trim(p_referral_code));

        IF v_referrer_merchant_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code');
        END IF;
        IF v_referrer_merchant_id = p_merchant_id THEN
            RETURN jsonb_build_object('success', false, 'error', 'Cannot use your own code');
        END IF;
    END IF;

    INSERT INTO public.merchant_ad_placements (merchant_id, referred_by_merchant_id, amount_cents, status)
    VALUES (p_merchant_id, v_referrer_merchant_id, 50000, 'pending_payment')
    RETURNING id INTO v_placement_id;

    RETURN jsonb_build_object('success', true, 'placement_id', v_placement_id, 'amount_cents', 50000);
END;
$function$;

-- Called once WiPay confirms real payment for a placement. Activates the
-- 30-day window and pays the referring merchant's cut, if any, straight to
-- their wallet -- a real wallet_transactions row, same ledger every other
-- merchant credit in this codebase uses. Idempotent: re-running on an
-- already-active placement changes nothing and pays nothing twice.
CREATE OR REPLACE FUNCTION public.activate_merchant_ad_placement(
    p_placement_id uuid,
    p_wipay_transaction_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_placement    record;
    v_cut_bps      integer;
    v_cut_cents    integer;
    v_referrer_uid uuid;
BEGIN
    SELECT * INTO v_placement
    FROM public.merchant_ad_placements
    WHERE id = p_placement_id AND status = 'pending_payment'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Placement not found or already processed');
    END IF;

    UPDATE public.merchant_ad_placements
    SET status = 'active',
        wipay_transaction_id = p_wipay_transaction_id,
        starts_at = now(),
        expires_at = now() + interval '30 days',
        activated_at = now()
    WHERE id = p_placement_id;

    IF v_placement.referred_by_merchant_id IS NOT NULL THEN
        SELECT (value_cents) INTO v_cut_bps FROM public.pricing_config WHERE key = 'MERCHANT_AD_REFERRAL_CUT_BPS';
        v_cut_bps := COALESCE(v_cut_bps, 1000);
        v_cut_cents := (v_placement.amount_cents * v_cut_bps) / 10000;

        SELECT created_by INTO v_referrer_uid FROM public.merchants WHERE id = v_placement.referred_by_merchant_id;

        IF v_referrer_uid IS NOT NULL AND v_cut_cents > 0 THEN
            INSERT INTO public.wallet_transactions (user_id, amount, transaction_type, description, status, reference_id)
            VALUES (v_referrer_uid, v_cut_cents, 'bonus',
                    'Merchant ad-space referral cut', 'completed', p_placement_id::text);

            UPDATE public.merchant_ad_placements
            SET referral_cut_cents = v_cut_cents
            WHERE id = p_placement_id;
        END IF;
    END IF;

    RETURN jsonb_build_object('success', true, 'placement_id', p_placement_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.activate_merchant_ad_placement(uuid, text) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.activate_merchant_ad_placement(uuid, text) TO service_role;
