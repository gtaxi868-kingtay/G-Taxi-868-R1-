-- apply_referral_code rejected every service-role caller unconditionally
-- (2026-09-15)
--
-- `IF p_referee_id IS DISTINCT FROM auth.uid()` returns TRUE whenever
-- auth.uid() is NULL and p_referee_id is any real UUID (a non-null value is
-- always DISTINCT FROM NULL) -- so every call made without a user JWT
-- session returns {success:false, error:'Unauthorized'}. Confirmed live in
-- a rolled-back transaction. This has been silently breaking
-- `supabase/functions/referral_driver_signup/index.ts`'s existing call
-- (`console.error(...)` on failure, never surfaced) since it was written,
-- and would have broken the new merchant-referral call in
-- merchant_register_with_code the same way.
--
-- Fixed to the same pattern generate_referral_code already uses correctly:
-- only enforce the self-service auth.uid() match when a real session
-- exists. A NULL auth.uid() means a trusted server-side caller
-- (service_role) already verified p_referee_id itself before calling in
-- (e.g. merchant_register_with_code just created that account and is
-- passing its own newUser.user.id).
CREATE OR REPLACE FUNCTION public.apply_referral_code(p_referee_id uuid, p_code text, p_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_referrer_id UUID;
    v_credit INTEGER := 1500;
BEGIN
    IF auth.uid() IS NOT NULL AND p_referee_id IS DISTINCT FROM auth.uid() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
    END IF;

    SELECT user_id INTO v_referrer_id FROM referral_codes WHERE code = upper(p_code) AND type = p_type;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code'); END IF;
    IF v_referrer_id = p_referee_id THEN RETURN jsonb_build_object('success', false, 'error', 'Cannot use own code'); END IF;
    IF EXISTS (SELECT 1 FROM referral_earnings WHERE referee_id = p_referee_id AND type = p_type) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Referral already used');
    END IF;

    INSERT INTO wallet_transactions (user_id, amount, transaction_type, description, status)
    VALUES
        (v_referrer_id, v_credit, 'bonus', format('Referral bonus — new %s signup', p_type), 'completed'),
        (p_referee_id,  v_credit, 'bonus', 'Welcome bonus — referral code applied', 'completed');

    INSERT INTO referral_earnings (referrer_id, referee_id, type, amount_cents, status, expires_at)
    VALUES (v_referrer_id, p_referee_id, p_type, v_credit, 'paid', now() + interval '90 days');

    IF p_type = 'rider' THEN
        UPDATE profiles SET referred_by_rider_id = v_referrer_id WHERE id = p_referee_id AND referred_by_rider_id IS NULL;
    END IF;

    UPDATE referral_codes SET uses = uses + 1 WHERE code = upper(p_code);

    RETURN jsonb_build_object('success', true, 'referrer_id', v_referrer_id, 'credit_cents', v_credit);
END;
$function$;
