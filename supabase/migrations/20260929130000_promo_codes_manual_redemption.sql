-- ═══════════════════════════════════════════════════════════════════════════
-- Promo codes — manual model, real server-side redemption — 2026-09-29
--
-- Pilot needs a handout-able code (e.g. HISANNA20) a rider types in, that
-- actually discounts a real ride's fare math, trackably. This is deliberately
-- NOT the auto-issued referral-coupon system from the stale handover branch
-- (that one is a different feature: earned after 10 rides, never typed in).
--
-- The old PromoScreen (killed in aa12fe61) inserted a user_promos row and
-- showed a success alert -- that's it. No fare-math integration existed.
-- This migration wires the discount into the SAME live mechanism already
-- used for the rider-Level/G-Member loyalty discount: compute_ride_split's
-- p_discount_cents parameter, which is ALREADY capped so it can only ever
-- reduce the platform's own cut (see v_discount_applied :=
-- LEAST(p_discount_cents, GREATEST(v_platform_fee,0)) in compute_ride_split
-- -- driver_net, commander_cut, and reserve are computed BEFORE that line
-- and are never touched). Because that mechanism already exists and is
-- already live, this migration does NOT touch process_wallet_payment_hardened
-- or compute_ride_split at all -- zero risk of the credit_driver_payout
-- regression found when reviewing the stale migration.
--
-- Flow: rider claims a code (PromoScreen) -> attached to their next
-- requested ride (create_ride) -> redeemed into the fare math at settlement
-- (complete_ride, alongside the existing loyalty-discount block) -> tracked
-- on user_promos (ride_id, discount_cents_applied) and admin_promos
-- (current_uses).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Which code (if any) is riding along with this specific ride.
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS applied_promo_code text REFERENCES public.admin_promos(code);

-- 2. Tie a claim to the ride it was actually redeemed on, and record exactly
--    how much discount that redemption produced -- "trackable" per Taylor.
ALTER TABLE public.user_promos
  ADD COLUMN IF NOT EXISTS ride_id uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_cents_applied integer;

-- 3. RLS hardening: the existing "Users view and claim their own promos"
--    policy is FOR ALL with only a USING clause (auth.uid() = user_id) and
--    no WITH CHECK -- meaning a client could INSERT a claim directly via
--    PostgREST for ANY code, bypassing max_uses/expiry/is_active validation
--    entirely (exactly how the old, killed PromoScreen worked). Replacing
--    it with SELECT-only for own rows; every write now goes through
--    claim_promo_code / redeem_promo_code below, which validate for real.
DROP POLICY IF EXISTS "Users view and claim their own promos" ON public.user_promos;
CREATE POLICY "Users view their own promos" ON public.user_promos
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 3b. Fix trg_emit_promo_notification's function: it references a table
--     (public.promos) and column (user_promos.promo_id) that DO NOT EXIST
--     -- the real tables are admin_promos (PK: code) / user_promos
--     (promo_code, no promo_id). This means every INSERT into user_promos,
--     ever, including via the old (killed) PromoScreen, would have thrown
--     at the trigger and failed the whole claim. Caught by dry-running
--     this migration's own functional test -- confirmed via a rolled-back
--     transaction that INSERT into user_promos errors with
--     "relation public.promos does not exist" on current live schema.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_user_on_promo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  PERFORM public.notify_user(
    NEW.user_id,
    'promo',
    'New promo available!',
    COALESCE(
      (SELECT description FROM public.admin_promos WHERE code = NEW.promo_code LIMIT 1),
      'Check your promos for a special offer.'
    )
  );
  RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Claim a code. Real validation: exists, active, not expired, under
--    max_uses, not already claimed by this rider (UNIQUE(user_id,
--    promo_code) backs the last one). Claiming does NOT redeem it -- it
--    just marks it as this rider's active, unused claim, picked up by the
--    next ride they request.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_promo_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_promo   record;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
    END IF;
    IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Enter a code');
    END IF;

    SELECT * INTO v_promo FROM public.admin_promos
    WHERE code = upper(trim(p_code))
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'This promo code doesn''t exist');
    END IF;
    IF NOT v_promo.is_active THEN
        RETURN jsonb_build_object('success', false, 'message', 'This promo code is no longer active');
    END IF;
    IF v_promo.expires_at IS NOT NULL AND v_promo.expires_at <= now() THEN
        RETURN jsonb_build_object('success', false, 'message', 'This promo code has expired');
    END IF;
    IF v_promo.current_uses >= v_promo.max_uses THEN
        RETURN jsonb_build_object('success', false, 'message', 'This promo code has been fully claimed');
    END IF;

    BEGIN
        INSERT INTO public.user_promos (user_id, promo_code, is_used)
        VALUES (v_user_id, v_promo.code, false);
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'message', 'You''ve already claimed this code');
    END;

    RETURN jsonb_build_object(
        'success', true,
        'code', v_promo.code,
        'discount_percent', v_promo.discount_percent,
        'message', format('%s%% off applied to your next ride', v_promo.discount_percent)
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.claim_promo_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_promo_code(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Redeem: called from complete_ride (service_role only) once a ride
--    with an applied_promo_code actually settles. Computes the discount
--    from the real fare, marks the claim used, ties it to this ride, and
--    atomically increments admin_promos.current_uses -- all in one
--    SECURITY DEFINER call so concurrent redemptions of a near-cap code
--    can't both slip through max_uses.
--
--    Returns the discount in cents for the CALLER to fold into the same
--    p_discount_cents already threaded through compute_ride_split /
--    process_wallet_payment_hardened for the loyalty discount -- this
--    function does not call either of those itself. Note: the actual
--    amount absorbed may be LESS than what's returned here if it's large
--    enough to hit compute_ride_split's platform-fee cap (same protection
--    the loyalty discount already gets) -- discount_cents_applied records
--    what this function computed, not the post-cap amount.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.redeem_promo_code(
    p_ride_id uuid,
    p_rider_id uuid,
    p_code text,
    p_fare_cents integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_promo   record;
    v_cents   integer;
    v_updated integer;
BEGIN
    IF p_code IS NULL OR p_fare_cents IS NULL OR p_fare_cents <= 0 THEN
        RETURN 0;
    END IF;

    SELECT * INTO v_promo FROM public.admin_promos WHERE code = p_code FOR UPDATE;
    IF NOT FOUND OR NOT v_promo.is_active THEN
        RETURN 0;
    END IF;
    IF v_promo.expires_at IS NOT NULL AND v_promo.expires_at <= now() THEN
        RETURN 0;
    END IF;

    -- Atomic: only a still-unused claim, by this rider, for this exact
    -- code, gets redeemed. A ride whose promo was claimed but then the
    -- code got deactivated/expired mid-ride correctly redeems nothing.
    UPDATE public.user_promos
    SET is_used = true, ride_id = p_ride_id,
        discount_cents_applied = FLOOR(p_fare_cents * v_promo.discount_percent / 100.0)::integer
    WHERE user_id = p_rider_id AND promo_code = p_code AND is_used = false
    RETURNING discount_cents_applied INTO v_cents;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
        RETURN 0;
    END IF;

    UPDATE public.admin_promos
    SET current_uses = current_uses + 1
    WHERE code = p_code AND current_uses < max_uses;

    RETURN COALESCE(v_cents, 0);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.redeem_promo_code(uuid, uuid, text, integer) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.redeem_promo_code(uuid, uuid, text, integer) TO service_role;
