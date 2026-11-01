-- A merchant referral pays only on an approved business's first real delivered
-- order, and only once. Run after the migration, inside a transaction: every
-- path raises on failure and the last line always raises, so nothing here can
-- stick.

DO $$
DECLARE
    v_code     text;
    v_referrer uuid;
    v_owner    uuid;
    v_rider    uuid;
    v_merchant uuid;
    v_order    uuid;
    v_r        jsonb;
    v_money    bigint;
    v_earning  uuid;
BEGIN
    SELECT user_id, code INTO v_referrer, v_code FROM public.referral_codes WHERE type = 'merchant' LIMIT 1;
    SELECT id INTO v_owner FROM public.profiles WHERE id <> v_referrer LIMIT 1;
    SELECT id INTO v_rider FROM public.profiles WHERE id NOT IN (v_referrer, v_owner) LIMIT 1;
    SELECT id INTO v_merchant FROM public.merchants LIMIT 1;
    IF v_code IS NULL OR v_owner IS NULL OR v_rider IS NULL OR v_merchant IS NULL THEN
        RAISE EXCEPTION 'test data missing';
    END IF;
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    UPDATE public.merchants SET created_by = v_owner, activation_status = 'pending', is_active = true WHERE id = v_merchant;
    DELETE FROM public.referral_earnings WHERE referee_id = v_owner AND type = 'merchant';

    -- 1. Sign-up records it and moves no money.
    SELECT COALESCE(sum(amount), 0) INTO v_money FROM public.wallet_transactions WHERE user_id IN (v_referrer, v_owner);
    v_r := public.apply_referral_code(v_owner, v_code, 'merchant');
    IF NOT (v_r->>'success')::boolean THEN RAISE EXCEPTION '1 failed: %', v_r; END IF;
    SELECT id INTO v_earning FROM public.referral_earnings WHERE referee_id = v_owner AND type = 'merchant' AND status = 'pending';
    IF v_earning IS NULL THEN RAISE EXCEPTION '1 failed: not pending'; END IF;
    IF (SELECT COALESCE(sum(amount), 0) FROM public.wallet_transactions WHERE user_id IN (v_referrer, v_owner)) <> v_money THEN
        RAISE EXCEPTION '1 failed: money moved at sign-up';
    END IF;

    -- 2. A delivery before approval does not pay.
    INSERT INTO public.orders (rider_id, merchant_id, status, total_cents) VALUES (v_rider, v_merchant, 'confirmed', 5000) RETURNING id INTO v_order;
    UPDATE public.orders SET status = 'delivered' WHERE id = v_order;
    IF (SELECT status FROM public.referral_earnings WHERE id = v_earning) <> 'pending' THEN RAISE EXCEPTION '2 failed: paid before approval'; END IF;

    -- 3. Approved: the owner's own order does not pay.
    UPDATE public.merchants SET activation_status = 'active', is_active = true WHERE id = v_merchant;
    INSERT INTO public.orders (rider_id, merchant_id, status, total_cents) VALUES (v_owner, v_merchant, 'confirmed', 5000) RETURNING id INTO v_order;
    UPDATE public.orders SET status = 'delivered' WHERE id = v_order;
    IF (SELECT status FROM public.referral_earnings WHERE id = v_earning) <> 'pending' THEN RAISE EXCEPTION '3 failed: own order paid'; END IF;

    -- 4. Nor does the referrer's order.
    INSERT INTO public.orders (rider_id, merchant_id, status, total_cents) VALUES (v_referrer, v_merchant, 'confirmed', 5000) RETURNING id INTO v_order;
    UPDATE public.orders SET status = 'delivered' WHERE id = v_order;
    IF (SELECT status FROM public.referral_earnings WHERE id = v_earning) <> 'pending' THEN RAISE EXCEPTION '4 failed: referrer order paid'; END IF;

    -- 5. A customer's delivered order pays both sides.
    INSERT INTO public.orders (rider_id, merchant_id, status, total_cents) VALUES (v_rider, v_merchant, 'confirmed', 5000) RETURNING id INTO v_order;
    UPDATE public.orders SET status = 'delivered' WHERE id = v_order;
    IF (SELECT status FROM public.referral_earnings WHERE id = v_earning) <> 'paid' THEN RAISE EXCEPTION '5 failed: not paid'; END IF;
    IF (SELECT count(*) FROM public.wallet_transactions WHERE reference_id = 'referral:' || v_earning::text) <> 2 THEN RAISE EXCEPTION '5 failed: bonus rows'; END IF;

    -- 6. The next delivered order pays nothing more.
    INSERT INTO public.orders (rider_id, merchant_id, status, total_cents) VALUES (v_rider, v_merchant, 'confirmed', 5000) RETURNING id INTO v_order;
    UPDATE public.orders SET status = 'delivered' WHERE id = v_order;
    IF (SELECT count(*) FROM public.wallet_transactions WHERE reference_id = 'referral:' || v_earning::text) <> 2 THEN RAISE EXCEPTION '6 failed: paid twice'; END IF;

    RAISE EXCEPTION 'ALL PASSED';
END $$;
