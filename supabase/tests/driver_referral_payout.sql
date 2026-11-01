-- A driver referral pays only after approval and the target rides, and only
-- once. Run after the migration, inside a transaction: every path raises on
-- failure and the last line always raises, so nothing here can stick.

DO $$
DECLARE
    v_code     text;
    v_referrer uuid;
    v_new      uuid;
    v_rider    uuid;
    v_target   int;
    v_ride     uuid;
    v_r        jsonb;
    v_money    bigint;
    v_rewards  bigint;
    v_earning  record;
    i          int;
BEGIN
    SELECT value_cents INTO v_target FROM public.pricing_config WHERE key = 'DRIVER_REFERRAL_TARGET_RIDES';
    SELECT rc.user_id, rc.code INTO v_referrer, v_code
      FROM public.referral_codes rc JOIN public.drivers d ON d.user_id = rc.user_id
     WHERE rc.type = 'driver' LIMIT 1;
    SELECT d.id INTO v_new FROM public.drivers d WHERE d.id <> v_referrer LIMIT 1;
    SELECT p.id INTO v_rider FROM public.profiles p WHERE p.id NOT IN (v_referrer, v_new) LIMIT 1;
    IF v_code IS NULL OR v_new IS NULL OR v_rider IS NULL THEN RAISE EXCEPTION 'test data missing'; END IF;

    -- Approval is a service-role change; protect_driver_sensitive_columns refuses anyone else.
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    UPDATE public.drivers SET is_verified = false, verified_status = 'pending' WHERE id = v_new;
    DELETE FROM public.referral_earnings WHERE referee_id = v_new AND type = 'driver';

    -- 1. Sign-up records it and moves no money.
    SELECT COALESCE(sum(amount), 0) INTO v_money FROM public.wallet_transactions WHERE user_id IN (v_referrer, v_new);
    v_r := public.apply_referral_code(v_new, v_code, 'driver');
    IF NOT (v_r->>'success')::boolean THEN RAISE EXCEPTION '1 failed: %', v_r; END IF;
    IF (SELECT COALESCE(sum(amount), 0) FROM public.wallet_transactions WHERE user_id IN (v_referrer, v_new)) <> v_money THEN
        RAISE EXCEPTION '1 failed: money moved at sign-up';
    END IF;
    IF (SELECT status FROM public.referral_earnings WHERE referee_id = v_new AND type = 'driver') <> 'pending' THEN
        RAISE EXCEPTION '1 failed: not pending';
    END IF;

    -- 2. A ride before approval does not count.
    INSERT INTO public.rides (rider_id, driver_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, status, platform_fee_cents)
    VALUES (v_rider, v_new, 10.65, -61.5, 10.66, -61.51, 'completed', 1000) RETURNING id INTO v_ride;
    v_r := public.increment_driver_referral_reward(v_new, v_ride);
    IF v_r->>'message' <> 'Driver not approved yet' THEN RAISE EXCEPTION '2 failed: %', v_r; END IF;
    IF EXISTS (SELECT 1 FROM public.driver_referral_rewards WHERE referee_id = v_new AND rides_completed > 0) THEN
        RAISE EXCEPTION '2 failed: counted';
    END IF;

    -- 3. Approved, one ride short: still nothing paid.
    UPDATE public.drivers SET is_verified = true, verified_status = 'approved' WHERE id = v_new;
    FOR i IN 1..(v_target - 1) LOOP
        INSERT INTO public.rides (rider_id, driver_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, status, platform_fee_cents)
        VALUES (v_rider, v_new, 10.65, -61.5, 10.66, -61.51, 'completed', 1000) RETURNING id INTO v_ride;
        v_r := public.increment_driver_referral_reward(v_new, v_ride);
    END LOOP;
    IF (SELECT status FROM public.referral_earnings WHERE referee_id = v_new AND type = 'driver') <> 'pending' THEN
        RAISE EXCEPTION '3 failed: paid early %', v_r;
    END IF;

    -- 4. The target ride pays both drivers once.
    INSERT INTO public.rides (rider_id, driver_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, status, platform_fee_cents)
    VALUES (v_rider, v_new, 10.65, -61.5, 10.66, -61.51, 'completed', 1000) RETURNING id INTO v_ride;
    v_r := public.increment_driver_referral_reward(v_new, v_ride);
    SELECT * INTO v_earning FROM public.referral_earnings WHERE referee_id = v_new AND type = 'driver';
    IF v_earning.status <> 'paid' OR v_earning.ride_id <> v_ride THEN RAISE EXCEPTION '4 failed: %', v_r; END IF;
    SELECT count(*) INTO v_rewards FROM public.wallet_transactions WHERE reference_id = 'referral:' || v_earning.id::text;
    IF v_rewards <> 2 THEN RAISE EXCEPTION '4 failed: % bonus rows', v_rewards; END IF;

    -- 5. The same ride again, then a later ride, never pay the bonus twice.
    v_r := public.increment_driver_referral_reward(v_new, v_ride);
    INSERT INTO public.rides (rider_id, driver_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, status, platform_fee_cents)
    VALUES (v_rider, v_new, 10.65, -61.5, 10.66, -61.51, 'completed', 1000) RETURNING id INTO v_ride;
    v_r := public.increment_driver_referral_reward(v_new, v_ride);
    IF (SELECT count(*) FROM public.wallet_transactions WHERE reference_id = 'referral:' || v_earning.id::text) <> 2 THEN
        RAISE EXCEPTION '5 failed: paid twice';
    END IF;

    RAISE EXCEPTION 'ALL PASSED';
END $$;
