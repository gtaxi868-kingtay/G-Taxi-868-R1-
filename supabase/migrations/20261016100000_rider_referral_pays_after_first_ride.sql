-- ═══════════════════════════════════════════════════════════════════
-- Rider referral: the TT$15 each pays after the referred rider's FIRST
-- COMPLETED RIDE, not at sign-up (founder decision, 2026-10-16).
--
-- Before: apply_referral_code credited TT$15 to both people the moment a
-- rider signed up with a code, while the rider app's Referral screen says
-- "When a friend takes their first ride, you both earn TTD $15".
--
-- After:
--   apply_referral_code(..., 'rider') records the referral as 'pending'
--   and pays nothing. Driver and merchant codes are unchanged (they still
--   pay at sign-up; the driver-refers-driver reward reads the 'paid' driver
--   row, so it must not move).
--   pay_rider_referral_on_first_ride(referee, ride) pays both TT$15 once,
--   on the first completed ride of that rider, within the existing 90-day
--   expires_at window. Called by complete_ride (service role only).
--   Idempotent: the pending row is locked and flipped to 'paid' in the
--   same transaction as the two credits.
-- ═══════════════════════════════════════════════════════════════════

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

    IF p_type = 'rider' THEN
        -- Recorded now, paid by pay_rider_referral_on_first_ride.
        INSERT INTO referral_earnings (referrer_id, referee_id, type, amount_cents, status, expires_at)
        VALUES (v_referrer_id, p_referee_id, p_type, v_credit, 'pending', now() + interval '90 days');

        UPDATE profiles SET referred_by_rider_id = v_referrer_id WHERE id = p_referee_id AND referred_by_rider_id IS NULL;
        UPDATE referral_codes SET uses = uses + 1 WHERE code = upper(p_code);

        RETURN jsonb_build_object('success', true, 'referrer_id', v_referrer_id, 'credit_cents', v_credit,
                                  'pays_on', 'first_completed_ride');
    END IF;

    INSERT INTO wallet_transactions (user_id, amount, transaction_type, description, status)
    VALUES
        (v_referrer_id, v_credit, 'bonus', format('Referral bonus — new %s signup', p_type), 'completed'),
        (p_referee_id,  v_credit, 'bonus', 'Welcome bonus — referral code applied', 'completed');

    INSERT INTO referral_earnings (referrer_id, referee_id, type, amount_cents, status, expires_at)
    VALUES (v_referrer_id, p_referee_id, p_type, v_credit, 'paid', now() + interval '90 days');

    UPDATE referral_codes SET uses = uses + 1 WHERE code = upper(p_code);

    RETURN jsonb_build_object('success', true, 'referrer_id', v_referrer_id, 'credit_cents', v_credit);
END;
$function$;

CREATE OR REPLACE FUNCTION public.pay_rider_referral_on_first_ride(p_referee_id uuid, p_ride_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_ref record;
    v_ride record;
BEGIN
    SELECT id, rider_id, status INTO v_ride FROM public.rides WHERE id = p_ride_id;
    IF v_ride.id IS NULL OR v_ride.status <> 'completed' OR v_ride.rider_id IS DISTINCT FROM p_referee_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'Ride not found, not completed, or rider mismatch');
    END IF;

    SELECT id, referrer_id, amount_cents, expires_at INTO v_ref
      FROM public.referral_earnings
     WHERE referee_id = p_referee_id AND type = 'rider' AND status = 'pending'
     FOR UPDATE;
    IF v_ref.id IS NULL THEN
        RETURN jsonb_build_object('success', true, 'paid', false, 'message', 'No pending rider referral');
    END IF;

    IF v_ref.expires_at IS NOT NULL AND v_ref.expires_at < now() THEN
        UPDATE public.referral_earnings SET status = 'expired' WHERE id = v_ref.id;
        RETURN jsonb_build_object('success', true, 'paid', false, 'message', 'Referral expired before first ride');
    END IF;

    INSERT INTO public.wallet_transactions (user_id, amount, transaction_type, description, reference_id, status)
    VALUES
        (v_ref.referrer_id, v_ref.amount_cents, 'bonus', 'Referral bonus — your friend took their first ride',
         'referral:' || v_ref.id::text, 'completed'),
        (p_referee_id, v_ref.amount_cents, 'bonus', 'Welcome bonus — first ride with a referral code',
         'referral:' || v_ref.id::text, 'completed');

    UPDATE public.referral_earnings SET status = 'paid', ride_id = p_ride_id WHERE id = v_ref.id;

    RETURN jsonb_build_object('success', true, 'paid', true, 'credit_cents', v_ref.amount_cents,
                              'referrer_id', v_ref.referrer_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.pay_rider_referral_on_first_ride(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pay_rider_referral_on_first_ride(uuid, uuid) TO service_role;
