-- Drivers hear about people signing up near them. Every rider or shop that joins
-- the waitlist alerts the closest drivers within 15 km, and a new driver can see
-- who has already joined near their home town. Counts only: no names or numbers
-- ever reach a driver. Riders who sign up in the app give no town, so they are
-- not counted here.

ALTER TABLE public.drivers
    ADD COLUMN IF NOT EXISTS home_town text,
    ADD COLUMN IF NOT EXISTS home_lat double precision,
    ADD COLUMN IF NOT EXISTS home_lng double precision;

-- Where a waitlist row is: the town's centre, or the centre of the area for
-- sign-ups from before the town search. Anyone can post to the waitlist, so
-- details is never trusted to hold numbers.
CREATE OR REPLACE FUNCTION public.waitlist_position(p_community text, p_details jsonb, OUT lat double precision, OUT lng double precision)
LANGUAGE sql IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
    SELECT COALESCE(CASE WHEN jsonb_typeof(p_details->'town_lat') = 'number' THEN (p_details->>'town_lat')::double precision END, a.lat),
           COALESCE(CASE WHEN jsonb_typeof(p_details->'town_lng') = 'number' THEN (p_details->>'town_lng')::double precision END, a.lng)
      FROM (SELECT 1) one
      LEFT JOIN (VALUES
        ('Port of Spain', 10.657, -61.518), ('San Fernando', 10.281, -61.465), ('Chaguanas', 10.515, -61.408),
        ('Arima', 10.637, -61.283), ('Diego Martin / Westmoorings', 10.736, -61.558),
        ('Tunapuna / St. Augustine', 10.645, -61.395), ('Couva / Point Lisas', 10.41, -61.47),
        ('Sangre Grande', 10.587, -61.128), ('Princes Town / Debe', 10.24, -61.41), ('Tobago', 11.185, -60.735)
      ) AS a(name, lat, lng) ON a.name = p_community;
$function$;

CREATE OR REPLACE FUNCTION public.km_between(p_lat1 double precision, p_lng1 double precision, p_lat2 double precision, p_lng2 double precision)
RETURNS double precision
LANGUAGE sql IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
    SELECT sqrt(power(p_lat1 - p_lat2, 2) + power((p_lng1 - p_lng2) * cos(radians((p_lat1 + p_lat2) / 2)), 2)) * 111.2;
$function$;

CREATE OR REPLACE FUNCTION public.alert_drivers_of_signup()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_pos   record;
    v_title text;
    v_body  text;
    rec     record;
BEGIN
    SELECT * INTO v_pos FROM public.waitlist_position(NEW.community, NEW.details);
    IF v_pos.lat IS NULL OR v_pos.lng IS NULL THEN
        RETURN NEW;
    END IF;

    v_title := CASE NEW.user_type WHEN 'sell' THEN 'A new shop near you' ELSE 'A new rider near you' END;
    v_body  := format('Someone in %s just joined G 868.', NEW.community);

    FOR rec IN
        SELECT d.user_id, d.push_token
          FROM public.drivers d
         CROSS JOIN LATERAL (SELECT COALESCE(d.home_lat, d.lat) AS lat, COALESCE(d.home_lng, d.lng) AS lng) p
         WHERE COALESCE(d.is_bot, false) = false
           AND d.user_id IS NOT NULL
           AND p.lat IS NOT NULL AND p.lng IS NOT NULL
           AND public.km_between(p.lat, p.lng, v_pos.lat, v_pos.lng) <= 15
         ORDER BY public.km_between(p.lat, p.lng, v_pos.lat, v_pos.lng) ASC
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
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- An alert problem must never stop someone signing up.
    RAISE WARNING 'alert_drivers_of_signup failed for %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.alert_drivers_of_signup() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_alert_drivers_of_signup ON public.waitlist;
CREATE TRIGGER trg_alert_drivers_of_signup
    AFTER INSERT ON public.waitlist
    FOR EACH ROW
    WHEN (NEW.user_type IN ('ride', 'sell') AND NEW.status IS DISTINCT FROM 'rejected')
    EXECUTE FUNCTION public.alert_drivers_of_signup();

-- What a driver sees: who has joined within 15 km of them. Identity comes from
-- the JWT, and only counts come back.
CREATE OR REPLACE FUNCTION public.driver_area_signups()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_town text;
    v_lat  double precision;
    v_lng  double precision;
    v_out  jsonb;
BEGIN
    SELECT d.home_town, COALESCE(d.home_lat, d.lat), COALESCE(d.home_lng, d.lng)
      INTO v_town, v_lat, v_lng
      FROM public.drivers d WHERE d.user_id = auth.uid();
    IF v_lat IS NULL OR v_lng IS NULL THEN
        RETURN jsonb_build_object('town', v_town, 'riders', 0, 'shops', 0, 'radius_km', 15);
    END IF;

    SELECT jsonb_build_object('town', v_town, 'radius_km', 15,
             'riders', count(*) FILTER (WHERE w.user_type = 'ride'),
             'shops',  count(*) FILTER (WHERE w.user_type = 'sell'))
      INTO v_out
      FROM public.waitlist w
     CROSS JOIN LATERAL public.waitlist_position(w.community, w.details) p
     WHERE w.status IS DISTINCT FROM 'rejected'
       AND w.user_type IN ('ride', 'sell')
       AND p.lat IS NOT NULL
       AND public.km_between(v_lat, v_lng, p.lat, p.lng) <= 15;
    RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.driver_area_signups() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_area_signups() TO authenticated;
