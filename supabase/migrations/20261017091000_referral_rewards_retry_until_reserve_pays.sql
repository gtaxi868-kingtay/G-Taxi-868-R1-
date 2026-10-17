-- ═══════════════════════════════════════════════════════════════════
-- Referral rewards: never mark a reward "done" unless it was actually paid.
--
-- PROVEN 2026-10-17 in a rolled-back dry run: increment_driver_referral_reward
-- reached the 10th ride, computed TT$4.63, called spend_from_reserve, got
-- {"success": false, "error": "insufficient reserve"} (the reserve is empty
-- until real rides fund it) — but had ALREADY set reward_triggered = true,
-- so the reward could never be paid later. increment_referral_reward_rides
-- (driver onboards rider, 5%) and increment_rider_referral_reward (rider
-- refers rider, 3%) have the same order of operations.
--
-- Fix (all three): reward_triggered is set only after spend_from_reserve
-- succeeds. If the reserve cannot pay yet, the reward stays pending and is
-- retried on the referee's next completed ride (rides_completed keeps
-- counting past the target, so the target check still passes).
--
-- Driver-refers-driver also now sums the platform fee of the referee's
-- FIRST DRIVER_REFERRAL_TARGET_RIDES completed rides, matching the rule
-- ("5% of the platform's share of their first 10 rides"); it used to sum
-- every completed ride, which over-pays once retries happen later. The two
-- rider rewards are defined on LIFETIME fare (pricing_config descriptions)
-- and keep that.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.increment_driver_referral_reward(p_referee_driver_user_id uuid, p_ride_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_ride record;
    v_referrer_id uuid;
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

    SELECT referrer_id INTO v_referrer_id
    FROM public.referral_earnings
    WHERE referee_id = p_referee_driver_user_id AND type = 'driver' AND status = 'paid'
    LIMIT 1;
    IF v_referrer_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'No driver referrer on this account');
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

CREATE OR REPLACE FUNCTION public.increment_referral_reward_rides(p_rider_id uuid, p_driver_id uuid, p_ride_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_ride record;
    v_reward record;
    v_target smallint;
    v_reward_bps numeric;
    v_lifetime_cents bigint;
    v_payout_cents bigint;
    v_spend jsonb;
BEGIN
    SELECT id, rider_id, driver_id, status INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
    IF v_ride IS NULL OR v_ride.status <> 'completed' OR v_ride.rider_id <> p_rider_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'Ride not found, not completed, or rider mismatch');
    END IF;
    IF v_ride.driver_id <> p_driver_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'Ride driver mismatch');
    END IF;

    INSERT INTO public.referral_reward_ride_ledger (reward_type, ride_id)
    VALUES ('driver_onboard_reward', p_ride_id)
    ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Ride already counted toward this reward');
    END IF;

    SELECT COALESCE(value_cents, 5) INTO v_target FROM public.pricing_config WHERE key = 'RIDER_REFERRAL_TARGET_RIDES';
    v_target := COALESCE(v_target, 5);
    SELECT COALESCE(value_cents, 500) INTO v_reward_bps FROM public.pricing_config WHERE key = 'DRIVER_ONBOARD_REWARD_BPS';
    v_reward_bps := COALESCE(v_reward_bps, 500);

    INSERT INTO public.referral_rewards (rider_id, driver_id, target_rides)
    VALUES (p_rider_id, p_driver_id, v_target)
    ON CONFLICT (rider_id, driver_id) DO NOTHING;

    UPDATE public.referral_rewards
    SET rides_completed = rides_completed + 1, updated_at = now()
    WHERE rider_id = p_rider_id AND driver_id = p_driver_id AND reward_triggered = false
    RETURNING * INTO v_reward;

    IF v_reward IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Reward already paid or not found');
    END IF;

    IF v_reward.rides_completed < v_target THEN
        RETURN jsonb_build_object('success', true, 'reward_triggered', false,
            'rides_completed', v_reward.rides_completed, 'rides_remaining', v_target - v_reward.rides_completed);
    END IF;

    SELECT COALESCE(sum(total_fare_cents), 0) INTO v_lifetime_cents
    FROM public.rides WHERE rider_id = p_rider_id AND status = 'completed';

    v_payout_cents := ROUND(v_lifetime_cents * v_reward_bps / 10000.0);

    IF v_payout_cents <= 0 THEN
        UPDATE public.referral_rewards SET reward_triggered = true WHERE id = v_reward.id;
        RETURN jsonb_build_object('success', true, 'reward_triggered', true, 'payout_cents', 0,
            'rides_completed', v_reward.rides_completed);
    END IF;

    v_spend := public.spend_from_reserve('driver_onboard_reward', p_driver_id, v_payout_cents, p_rider_id,
        format('Driver onboarding reward — %s%% of rider lifetime fare (%s TTD) after %s rides',
               (v_reward_bps/100.0)::text, (v_lifetime_cents/100.0)::text, v_reward.rides_completed));

    IF COALESCE((v_spend->>'success')::boolean, false) THEN
        UPDATE public.referral_rewards SET reward_triggered = true WHERE id = v_reward.id;
        RETURN jsonb_build_object('success', true, 'reward_triggered', true,
            'rides_completed', v_reward.rides_completed, 'payout_cents', v_payout_cents, 'reserve_result', v_spend);
    END IF;

    RETURN jsonb_build_object('success', true, 'reward_triggered', false, 'payout_pending', true,
        'rides_completed', v_reward.rides_completed, 'payout_cents', v_payout_cents, 'reserve_result', v_spend);
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment_rider_referral_reward(p_referee_rider_id uuid, p_ride_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_ride record;
    v_referrer_id uuid;
    v_target smallint;
    v_reward_bps numeric;
    v_reward record;
    v_lifetime_cents bigint;
    v_payout_cents bigint;
    v_spend jsonb;
BEGIN
    SELECT id, rider_id, status INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
    IF v_ride IS NULL OR v_ride.status <> 'completed' OR v_ride.rider_id <> p_referee_rider_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'Ride not found, not completed, or rider mismatch');
    END IF;

    SELECT referred_by_rider_id INTO v_referrer_id FROM public.profiles WHERE id = p_referee_rider_id;
    IF v_referrer_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'No rider referrer on this account');
    END IF;

    INSERT INTO public.referral_reward_ride_ledger (reward_type, ride_id)
    VALUES ('rider_onboard_reward', p_ride_id)
    ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Ride already counted toward this reward');
    END IF;

    SELECT COALESCE(value_cents, 5) INTO v_target FROM public.pricing_config WHERE key = 'RIDER_REFERRAL_TARGET_RIDES';
    v_target := COALESCE(v_target, 5);
    SELECT COALESCE(value_cents, 300) INTO v_reward_bps FROM public.pricing_config WHERE key = 'RIDER_ONBOARD_REWARD_BPS';
    v_reward_bps := COALESCE(v_reward_bps, 300);

    INSERT INTO public.rider_referral_rewards (referrer_rider_id, referee_rider_id, target_rides)
    VALUES (v_referrer_id, p_referee_rider_id, v_target)
    ON CONFLICT (referrer_rider_id, referee_rider_id) DO NOTHING;

    UPDATE public.rider_referral_rewards
    SET rides_completed = rides_completed + 1, updated_at = now()
    WHERE referrer_rider_id = v_referrer_id AND referee_rider_id = p_referee_rider_id AND reward_triggered = false
    RETURNING * INTO v_reward;

    IF v_reward IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Reward already paid or not found');
    END IF;

    IF v_reward.rides_completed < v_target THEN
        RETURN jsonb_build_object('success', true, 'reward_triggered', false,
            'rides_completed', v_reward.rides_completed, 'rides_remaining', v_target - v_reward.rides_completed);
    END IF;

    SELECT COALESCE(sum(total_fare_cents), 0) INTO v_lifetime_cents
    FROM public.rides WHERE rider_id = p_referee_rider_id AND status = 'completed';

    v_payout_cents := ROUND(v_lifetime_cents * v_reward_bps / 10000.0);

    IF v_payout_cents <= 0 THEN
        UPDATE public.rider_referral_rewards SET reward_triggered = true WHERE id = v_reward.id;
        RETURN jsonb_build_object('success', true, 'reward_triggered', true, 'payout_cents', 0);
    END IF;

    v_spend := public.spend_from_reserve('rider_onboard_reward', v_referrer_id, v_payout_cents, p_referee_rider_id,
        format('Friends & family reward — %s%% of referred rider lifetime fare (%s TTD) after %s rides',
               (v_reward_bps/100.0)::text, (v_lifetime_cents/100.0)::text, v_reward.rides_completed));

    IF COALESCE((v_spend->>'success')::boolean, false) THEN
        UPDATE public.rider_referral_rewards SET reward_triggered = true WHERE id = v_reward.id;
        RETURN jsonb_build_object('success', true, 'reward_triggered', true,
            'rides_completed', v_reward.rides_completed, 'payout_cents', v_payout_cents, 'reserve_result', v_spend);
    END IF;

    RETURN jsonb_build_object('success', true, 'reward_triggered', false, 'payout_pending', true,
        'rides_completed', v_reward.rides_completed, 'payout_cents', v_payout_cents, 'reserve_result', v_spend);
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════
-- spend_from_reserve: the only way referral rewards are paid. It has never
-- been able to pay anything (PROVEN 2026-10-17, rolled-back dry run with a
-- funded reserve): it inserted the spend into capital_reserve_ledger as a
-- NEGATIVE amount with status 'spent', source_type = the spend type and
-- ride_id = a user id — four violations of that table's checks/foreign key
-- (amount_cents > 0; status locked|released|deployed; source_type is an
-- inflow type; ride_id references rides). Every reward with money behind
-- it would have crashed.
--
-- capital_reserve_ledger is the INFLOW ledger; spends already have their
-- own ledger, reserve_spend_log. Available reserve is now computed from
-- the two ledgers (locked inflows minus paid spends) instead of trusting
-- reserve_health.locked_cents, which drifts: the card settlement path adds
-- to capital_reserve_ledger without updating it (live: ledger 86 cents,
-- reserve_health 0). reserve_health is refreshed here as a cache.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.spend_from_reserve(p_spend_type text, p_recipient_user_id uuid, p_amount_cents bigint, p_reference_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_available bigint;
    v_log_id uuid;
BEGIN
    IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'amount must be positive');
    END IF;

    -- Serialise every spend on the single reserve_health row.
    PERFORM 1 FROM public.reserve_health WHERE id = true FOR UPDATE;

    SELECT COALESCE((SELECT sum(amount_cents) FROM public.capital_reserve_ledger WHERE status = 'locked'), 0)
         - COALESCE((SELECT sum(amount_cents) FROM public.reserve_spend_log WHERE status = 'paid'), 0)
      INTO v_available;

    IF v_available < p_amount_cents THEN
        INSERT INTO public.reserve_spend_log (spend_type, recipient_user_id, amount_cents, status, reference_id, notes)
        VALUES (p_spend_type, p_recipient_user_id, p_amount_cents, 'deferred_insufficient_reserve', p_reference_id, p_notes)
        RETURNING id INTO v_log_id;
        RETURN jsonb_build_object('success', false, 'error', 'insufficient reserve', 'available_cents', v_available, 'log_id', v_log_id);
    END IF;

    INSERT INTO public.wallet_transactions (user_id, amount, transaction_type, description, status)
    VALUES (p_recipient_user_id, p_amount_cents, 'bonus', COALESCE(p_notes, p_spend_type), 'completed');

    INSERT INTO public.reserve_spend_log (spend_type, recipient_user_id, amount_cents, status, reference_id, notes)
    VALUES (p_spend_type, p_recipient_user_id, p_amount_cents, 'paid', p_reference_id, p_notes)
    RETURNING id INTO v_log_id;

    UPDATE public.reserve_health SET
        locked_cents = v_available - p_amount_cents,
        reserve_health_ratio = (v_available - p_amount_cents)::numeric / NULLIF(target_deployment_cents, 0),
        computed_at = now()
    WHERE id = true;

    RETURN jsonb_build_object('success', true, 'log_id', v_log_id, 'amount_cents', p_amount_cents);
END;
$function$;
