-- A driver referral now pays after the new driver is approved and finishes
-- DRIVER_REFERRAL_TARGET_RIDES real rides, not at sign-up. Paying at sign-up let
-- fake accounts collect TT$15 on each side. Same shape as the rider referral:
-- recorded as pending, paid by the ride counter. No expiry, because early
-- drivers may take a while to reach their rides. Merchant referrals unchanged.
-- Signatures are unchanged, so existing grants stay.

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

    IF p_type = 'driver' THEN
        -- Recorded now, paid by increment_driver_referral_reward once the new
        -- driver is approved and has finished DRIVER_REFERRAL_TARGET_RIDES.
        INSERT INTO referral_earnings (referrer_id, referee_id, type, amount_cents, status)
        VALUES (v_referrer_id, p_referee_id, p_type, v_credit, 'pending');

        UPDATE referral_codes SET uses = uses + 1 WHERE code = upper(p_code);

        RETURN jsonb_build_object('success', true, 'referrer_id', v_referrer_id, 'credit_cents', v_credit,
                                  'pays_on', 'approved_driver_rides');
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

CREATE OR REPLACE FUNCTION public.increment_driver_referral_reward(p_referee_driver_user_id uuid, p_ride_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_ride record;
    v_referrer_id uuid;
    v_earning record;
    v_target smallint;
    v_reward_bps numeric;
    v_reward record;
    v_first_rides_platform_fee_cents bigint;
    v_payout_cents bigint;
    v_spend jsonb;
BEGIN
    -- Real, completed ride on which this exact person was the driver.
    -- drivers.id == the driver's own auth user id (trigger
    -- drivers_default_id_from_user_id), so rides.driver_id compares directly.
    SELECT id, driver_id, status, platform_fee_cents INTO v_ride
    FROM public.rides WHERE id = p_ride_id FOR UPDATE;
    IF v_ride IS NULL OR v_ride.status <> 'completed' OR v_ride.driver_id <> p_referee_driver_user_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'Ride not found, not completed, or driver mismatch');
    END IF;

    SELECT id, referrer_id, amount_cents, status INTO v_earning
    FROM public.referral_earnings
    WHERE referee_id = p_referee_driver_user_id AND type = 'driver' AND status IN ('pending', 'paid')
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE;
    v_referrer_id := v_earning.referrer_id;
    IF v_referrer_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'No driver referrer on this account');
    END IF;

    -- Only rides after approval count toward the referral.
    IF NOT EXISTS (SELECT 1 FROM public.drivers
                    WHERE id = p_referee_driver_user_id AND is_verified = true AND verified_status = 'approved') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Driver not approved yet');
    END IF;

    INSERT INTO public.referral_reward_ride_ledger (reward_type, ride_id)
    VALUES ('driver_onboard_driver_reward', p_ride_id)
    ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Ride already counted toward this reward');
    END IF;

    SELECT COALESCE(value_cents, 10) INTO v_target FROM public.pricing_config WHERE key = 'DRIVER_REFERRAL_TARGET_RIDES';
    v_target := COALESCE(v_target, 10);
    SELECT COALESCE(value_cents, 500) INTO v_reward_bps FROM public.pricing_config WHERE key = 'DRIVER_ONBOARD_DRIVER_REWARD_BPS';
    v_reward_bps := COALESCE(v_reward_bps, 500);

    INSERT INTO public.driver_referral_rewards (referrer_id, referee_id, target_rides)
    VALUES (v_referrer_id, p_referee_driver_user_id, v_target)
    ON CONFLICT (referrer_id, referee_id) DO NOTHING;

    UPDATE public.driver_referral_rewards
    SET rides_completed = rides_completed + 1, updated_at = now()
    WHERE referrer_id = v_referrer_id AND referee_id = p_referee_driver_user_id AND reward_triggered = false
    RETURNING * INTO v_reward;

    IF v_reward IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Reward already paid or not found');
    END IF;

    IF v_reward.rides_completed < v_target THEN
        RETURN jsonb_build_object('success', true, 'reward_triggered', false,
            'rides_completed', v_reward.rides_completed, 'rides_remaining', v_target - v_reward.rides_completed);
    END IF;

    -- The signup bonus for both drivers. Paid before the reserve reward below,
    -- which can stay pending on an empty reserve; the status check keeps a
    -- retry on a later ride from paying it twice.
    IF v_earning.status = 'pending' THEN
        INSERT INTO public.wallet_transactions (user_id, amount, transaction_type, description, reference_id, status)
        VALUES
            (v_referrer_id, v_earning.amount_cents, 'bonus', 'Referral bonus — your driver finished their first rides',
             'referral:' || v_earning.id::text, 'completed'),
            (p_referee_driver_user_id, v_earning.amount_cents, 'bonus', 'Welcome bonus — first rides with a referral code',
             'referral:' || v_earning.id::text, 'completed');

        UPDATE public.referral_earnings SET status = 'paid', ride_id = p_ride_id WHERE id = v_earning.id;
    END IF;

    SELECT COALESCE(sum(f.platform_fee_cents), 0) INTO v_first_rides_platform_fee_cents
    FROM (SELECT platform_fee_cents FROM public.rides
           WHERE driver_id = p_referee_driver_user_id AND status = 'completed'
           ORDER BY COALESCE(completed_at, created_at) ASC
           LIMIT v_target) f;

    v_payout_cents := ROUND(v_first_rides_platform_fee_cents * v_reward_bps / 10000.0);

    IF v_payout_cents <= 0 THEN
        UPDATE public.driver_referral_rewards SET reward_triggered = true WHERE id = v_reward.id;
        RETURN jsonb_build_object('success', true, 'reward_triggered', true, 'payout_cents', 0,
            'rides_completed', v_reward.rides_completed);
    END IF;

    v_spend := public.spend_from_reserve('driver_onboard_driver_reward', v_referrer_id, v_payout_cents, p_referee_driver_user_id,
        format('Driver-refers-driver reward — %s%% of the platform share of the referred driver''s first %s rides (%s TTD)',
               (v_reward_bps/100.0)::text, v_target::text, (v_first_rides_platform_fee_cents/100.0)::text));

    IF COALESCE((v_spend->>'success')::boolean, false) THEN
        UPDATE public.driver_referral_rewards SET reward_triggered = true WHERE id = v_reward.id;
        RETURN jsonb_build_object('success', true, 'reward_triggered', true,
            'rides_completed', v_reward.rides_completed, 'payout_cents', v_payout_cents, 'reserve_result', v_spend);
    END IF;

    -- Reserve could not pay yet: stays pending, retried on the next completed ride.
    RETURN jsonb_build_object('success', true, 'reward_triggered', false, 'payout_pending', true,
        'rides_completed', v_reward.rides_completed, 'payout_cents', v_payout_cents, 'reserve_result', v_spend);
END;
$function$;
