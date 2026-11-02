-- Riders alert drivers once, and only owners and staff change a storefront. Run
-- after the migration, inside a transaction: every path raises on failure and
-- the last line always raises, so nothing here can stick.

DO $$
DECLARE
    v_driver   uuid;
    v_rider    uuid;
    v_stranger uuid;
    v_merchant uuid;
    v_owner    uuid;
    v_r        jsonb;
    v_n        bigint;
BEGIN
    SELECT user_id INTO v_driver FROM public.drivers WHERE user_id IS NOT NULL ORDER BY user_id LIMIT 1;
    SELECT id INTO v_rider FROM public.profiles WHERE id <> v_driver ORDER BY id LIMIT 1;
    SELECT id INTO v_owner FROM public.profiles WHERE id NOT IN (v_driver, v_rider) ORDER BY id LIMIT 1;
    SELECT id INTO v_stranger FROM public.profiles WHERE id NOT IN (v_driver, v_rider, v_owner) ORDER BY id LIMIT 1;
    SELECT id INTO v_merchant FROM public.merchants LIMIT 1;
    IF v_stranger IS NULL OR v_merchant IS NULL THEN RAISE EXCEPTION 'test data missing'; END IF;

    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    UPDATE public.drivers SET home_lat = NULL, home_lng = NULL, lat = 40, lng = -40;
    UPDATE public.drivers SET home_town = 'Marabella', home_lat = 10.307, home_lng = -61.452 WHERE user_id = v_driver;
    UPDATE public.profiles SET home_lat = NULL, home_lng = NULL, home_town = NULL;
    UPDATE public.merchants SET created_by = v_owner, is_open = false, business_type = NULL WHERE id = v_merchant;
    DELETE FROM public.waitlist;
    DELETE FROM public.merchant_staff WHERE merchant_id = v_merchant;

    -- 1. A rider's town alerts the driver once, even if set twice.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rider, 'role', 'authenticated')::text, true);
    v_r := public.rider_set_home_town('Marabella', 10.307, -61.452);
    IF NOT (v_r->>'success')::boolean THEN RAISE EXCEPTION '1 failed: %', v_r; END IF;
    v_r := public.rider_set_home_town('San Fernando', 10.281, -61.465);
    SELECT count(*) INTO v_n FROM public.notifications WHERE user_id = v_driver AND title = 'A new rider near you';
    IF v_n <> 1 THEN RAISE EXCEPTION '1 failed: % alerts', v_n; END IF;

    -- 2. Outside T&T, or no sign-in, is refused.
    v_r := public.rider_set_home_town('Miami', 25.76, -80.19);
    IF (v_r->>'success')::boolean THEN RAISE EXCEPTION '2 failed: outside'; END IF;
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    v_r := public.rider_set_home_town('Penal', 10.168, -61.453);
    IF (v_r->>'success')::boolean THEN RAISE EXCEPTION '2 failed: anon'; END IF;

    -- 3. The driver's count includes the app rider, and the waitlist trigger still works.
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    INSERT INTO public.waitlist (full_name, phone, user_type, source, community, details)
    VALUES ('Test Rider', '8687123456', 'ride', 'g868:Rider', 'Marabella', '{"town_lat":10.307,"town_lng":-61.452}');
    IF (SELECT count(*) FROM public.notifications WHERE user_id = v_driver AND title = 'A new rider near you') <> 2 THEN RAISE EXCEPTION '3 failed: trigger'; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_driver, 'role', 'authenticated')::text, true);
    v_r := public.driver_area_signups();
    IF (v_r->>'riders')::int <> 2 THEN RAISE EXCEPTION '3 failed: %', v_r; END IF;

    -- 4. Only the owner sets the type; a stranger cannot touch the storefront.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
    IF (public.merchant_set_open(v_merchant, true)->>'success')::boolean THEN RAISE EXCEPTION '4 failed: stranger open'; END IF;
    IF (public.merchant_set_business_type(v_merchant, 'food')->>'success')::boolean THEN RAISE EXCEPTION '4 failed: stranger type'; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    IF NOT (public.merchant_set_open(v_merchant, true)->>'success')::boolean THEN RAISE EXCEPTION '4 failed: owner open'; END IF;
    IF NOT (public.merchant_set_business_type(v_merchant, 'auto')->>'success')::boolean THEN RAISE EXCEPTION '4 failed: owner type'; END IF;
    IF (SELECT is_open FROM public.merchants WHERE id = v_merchant) IS NOT TRUE THEN RAISE EXCEPTION '4 failed: not open'; END IF;
    IF (SELECT business_type FROM public.merchants WHERE id = v_merchant) <> 'auto' THEN RAISE EXCEPTION '4 failed: type'; END IF;

    RAISE EXCEPTION 'ALL PASSED';
END $$;
