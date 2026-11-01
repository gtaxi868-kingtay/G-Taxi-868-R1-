-- Two additions. Riders who sign up in the app now give a town, so they alert
-- nearby drivers and count toward a driver's area, the same as a waitlist
-- sign-up. And a business has a type, which shapes its app, and can open or close
-- its own storefront. The authenticated role cannot update merchants or profiles
-- directly, so both go through checked functions.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS home_town text,
    ADD COLUMN IF NOT EXISTS home_lat double precision,
    ADD COLUMN IF NOT EXISTS home_lng double precision;

-- Separate from store_type, which rider searches filter on.
ALTER TABLE public.merchants
    ADD COLUMN IF NOT EXISTS business_type text
    CHECK (business_type IS NULL OR business_type IN
        ('food', 'drinks', 'grocery', 'health', 'retail', 'hardware', 'auto', 'beauty', 'stays', 'laundry', 'services'));

CREATE OR REPLACE FUNCTION public.alert_drivers_near(p_lat double precision, p_lng double precision, p_town text, p_kind text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_title text := CASE p_kind WHEN 'sell' THEN 'A new shop near you' ELSE 'A new rider near you' END;
    v_body  text := format('Someone in %s just joined G 868.', p_town);
    rec     record;
BEGIN
    FOR rec IN
        SELECT d.user_id, d.push_token
          FROM public.drivers d
         CROSS JOIN LATERAL (SELECT COALESCE(d.home_lat, d.lat) AS lat, COALESCE(d.home_lng, d.lng) AS lng) p
         WHERE COALESCE(d.is_bot, false) = false
           AND d.user_id IS NOT NULL
           AND p.lat IS NOT NULL AND p.lng IS NOT NULL
           AND public.km_between(p.lat, p.lng, p_lat, p_lng) <= 15
         ORDER BY public.km_between(p.lat, p.lng, p_lat, p_lng) ASC
         LIMIT 20
    LOOP
        PERFORM public.notify_user(rec.user_id, 'grid', v_title, v_body);
        IF rec.push_token LIKE 'ExponentPushToken%' THEN
            PERFORM net.http_post(
                url     := 'https://exp.host/--/api/v2/push/send',
                headers := jsonb_build_object('Content-Type', 'application/json'),
                body    := jsonb_build_object('to', rec.push_token, 'title', v_title, 'body', v_body,
                                              'sound', 'default', 'data', jsonb_build_object('type', 'area_signup')));
        END IF;
    END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.alert_drivers_near(double precision, double precision, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.alert_drivers_of_signup()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_pos record;
BEGIN
    SELECT * INTO v_pos FROM public.waitlist_position(NEW.community, NEW.details);
    IF v_pos.lat IS NOT NULL AND v_pos.lng IS NOT NULL THEN
        PERFORM public.alert_drivers_near(v_pos.lat, v_pos.lng, NEW.community, NEW.user_type);
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- An alert problem must never stop someone signing up.
    RAISE WARNING 'alert_drivers_of_signup failed for %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;

-- Identity comes from the JWT. Alerts fire once, the first time a town is set.
CREATE OR REPLACE FUNCTION public.rider_set_home_town(p_town text, p_lat double precision, p_lng double precision)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_first boolean;
    v_town  text := btrim(COALESCE(p_town, ''));
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
    END IF;
    IF char_length(v_town) NOT BETWEEN 2 AND 80
       OR p_lat NOT BETWEEN 9.9 AND 11.5 OR p_lng NOT BETWEEN -62 AND -60.3 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Pick a town in Trinidad and Tobago');
    END IF;

    SELECT home_lat IS NULL INTO v_first FROM public.profiles WHERE id = auth.uid();
    IF v_first IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No profile');
    END IF;

    UPDATE public.profiles SET home_town = v_town, home_lat = p_lat, home_lng = p_lng WHERE id = auth.uid();

    IF v_first THEN
        BEGIN
            PERFORM public.alert_drivers_near(p_lat, p_lng, v_town, 'ride');
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'rider_set_home_town alert failed: %', SQLERRM;
        END;
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.rider_set_home_town(text, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rider_set_home_town(text, double precision, double precision) TO authenticated;

-- A rider on both the waitlist and the app counts once.
CREATE OR REPLACE FUNCTION public.driver_area_signups()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_town   text;
    v_lat    double precision;
    v_lng    double precision;
    v_riders bigint;
    v_shops  bigint;
BEGIN
    SELECT d.home_town, COALESCE(d.home_lat, d.lat), COALESCE(d.home_lng, d.lng)
      INTO v_town, v_lat, v_lng
      FROM public.drivers d WHERE d.user_id = auth.uid();
    IF v_lat IS NULL OR v_lng IS NULL THEN
        RETURN jsonb_build_object('town', v_town, 'riders', 0, 'shops', 0, 'radius_km', 15);
    END IF;

    SELECT count(*) FILTER (WHERE w.user_type = 'ride'), count(*) FILTER (WHERE w.user_type = 'sell')
      INTO v_riders, v_shops
      FROM public.waitlist w
     CROSS JOIN LATERAL public.waitlist_position(w.community, w.details) p
     WHERE w.status IS DISTINCT FROM 'rejected'
       AND w.user_type IN ('ride', 'sell')
       AND p.lat IS NOT NULL
       AND public.km_between(v_lat, v_lng, p.lat, p.lng) <= 15;

    v_riders := v_riders + (
        SELECT count(*) FROM public.profiles pr
         WHERE pr.home_lat IS NOT NULL AND pr.home_lng IS NOT NULL
           AND public.km_between(v_lat, v_lng, pr.home_lat, pr.home_lng) <= 15
           AND NOT EXISTS (
                SELECT 1 FROM public.waitlist w
                 WHERE w.user_type = 'ride' AND w.status IS DISTINCT FROM 'rejected'
                   AND public.waitlist_normalize_tt_phone(w.phone) = public.waitlist_normalize_tt_phone(pr.phone_number)));

    RETURN jsonb_build_object('town', v_town, 'riders', v_riders, 'shops', v_shops, 'radius_km', 15);
END;
$function$;

CREATE OR REPLACE FUNCTION public.merchant_set_open(p_merchant_id uuid, p_is_open boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF p_is_open IS NULL OR p_merchant_id NOT IN (SELECT public.auth_merchant_ids()) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
    END IF;
    UPDATE public.merchants SET is_open = p_is_open WHERE id = p_merchant_id;
    RETURN jsonb_build_object('success', true, 'is_open', p_is_open);
END;
$function$;

CREATE OR REPLACE FUNCTION public.merchant_set_business_type(p_merchant_id uuid, p_type text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.merchants WHERE id = p_merchant_id AND created_by = auth.uid()) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only the owner can change this');
    END IF;
    UPDATE public.merchants SET business_type = p_type WHERE id = p_merchant_id;
    RETURN jsonb_build_object('success', true, 'business_type', p_type);
END;
$function$;

REVOKE ALL ON FUNCTION public.merchant_set_open(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.merchant_set_business_type(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_set_open(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merchant_set_business_type(uuid, text) TO authenticated;
