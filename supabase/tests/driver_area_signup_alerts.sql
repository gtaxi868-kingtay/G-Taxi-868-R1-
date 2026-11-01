-- New sign-ups reach only nearby drivers, a driver sees counts only, and a bad
-- sign-up is never blocked. Run after the migration, inside a transaction: every
-- path raises on failure and the last line always raises, so nothing here can
-- stick.

DO $$
DECLARE
    v_near   uuid;
    v_far    uuid;
    v_before bigint;
    v_r      jsonb;
BEGIN
    SELECT user_id INTO v_near FROM public.drivers WHERE user_id IS NOT NULL ORDER BY user_id LIMIT 1;
    SELECT user_id INTO v_far  FROM public.drivers WHERE user_id IS NOT NULL AND user_id <> v_near ORDER BY user_id LIMIT 1;
    IF v_near IS NULL OR v_far IS NULL THEN RAISE EXCEPTION 'test data missing'; END IF;

    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    UPDATE public.drivers SET home_lat = NULL, home_lng = NULL, lat = 40, lng = -40;
    UPDATE public.drivers SET home_town = 'Marabella', home_lat = 10.307, home_lng = -61.452 WHERE user_id = v_near;
    UPDATE public.drivers SET home_town = 'Arima', home_lat = 10.637, home_lng = -61.283 WHERE user_id = v_far;
    DELETE FROM public.waitlist;

    -- 1. A rider in Marabella alerts the near driver and not the far one.
    INSERT INTO public.waitlist (full_name, phone, user_type, source, community, details)
    VALUES ('Test Rider', '8687123456', 'ride', 'g868:Rider', 'Marabella', '{"area":"San Fernando","town_lat":10.307,"town_lng":-61.452}');
    IF (SELECT count(*) FROM public.notifications WHERE title LIKE 'A new % near you' AND user_id = v_near) <> 1 THEN RAISE EXCEPTION '1 failed: near driver'; END IF;
    IF (SELECT count(*) FROM public.notifications WHERE title LIKE 'A new % near you' AND user_id = v_far) <> 0 THEN RAISE EXCEPTION '1 failed: far driver'; END IF;
    IF EXISTS (SELECT 1 FROM public.notifications WHERE title LIKE 'A new % near you' AND body LIKE '%Test Rider%') THEN RAISE EXCEPTION '1 failed: name leaked'; END IF;

    -- 2. A shop counts too, an older area-only sign-up places by area, and a driver sign-up alerts nobody.
    INSERT INTO public.waitlist (full_name, phone, user_type, source, community, details)
    VALUES ('Test Shop', '8687123457', 'sell', 'g868:G-Partner (merchant)', 'San Fernando', '{}'),
           ('Test Driver', '8687123458', 'drive', 'g868:Driver', 'Marabella', '{"town_lat":10.307,"town_lng":-61.452}');
    IF (SELECT count(*) FROM public.notifications WHERE title LIKE 'A new % near you' AND user_id = v_near) <> 2 THEN RAISE EXCEPTION '2 failed'; END IF;

    -- 3. No position, or nonsense in details, never blocks the sign-up.
    SELECT count(*) INTO v_before FROM public.waitlist;
    INSERT INTO public.waitlist (full_name, phone, user_type, source, community, details)
    VALUES ('No Town', '8687123459', 'ride', 'g868:Rider', 'Nowhere', '{}'),
           ('Bad Data', '8687123450', 'ride', 'g868:Rider', 'Marabella', '{"town_lat":"oops"}');
    IF (SELECT count(*) FROM public.waitlist) <> v_before + 2 THEN RAISE EXCEPTION '3 failed: blocked'; END IF;

    -- 4. The driver's own view is counts within 15 km.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_near, 'role', 'authenticated')::text, true);
    v_r := public.driver_area_signups();
    IF (v_r->>'town') <> 'Marabella' OR (v_r->>'riders')::int <> 1 OR (v_r->>'shops')::int <> 1 THEN RAISE EXCEPTION '4 failed: %', v_r; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_far, 'role', 'authenticated')::text, true);
    v_r := public.driver_area_signups();
    IF (v_r->>'riders')::int <> 0 THEN RAISE EXCEPTION '4 failed: far %', v_r; END IF;

    RAISE EXCEPTION 'ALL PASSED';
END $$;
