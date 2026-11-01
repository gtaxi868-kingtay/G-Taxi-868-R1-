-- The page you put in front of an airline: real riders asking for a route,
-- counted by route and month. Counts only, never names, so it can be shared.
-- Admin-only, and identity comes from the JWT.

CREATE OR REPLACE FUNCTION public.admin_lane_demand()
RETURNS TABLE(origin_code text, destination_code text, destination_name text, travel_month date,
              riders bigint, seats bigint, first_ask timestamptz, latest_ask timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF (SELECT role::text FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: admin role required';
    END IF;
    RETURN QUERY
    SELECT i.origin_code, i.destination_code, max(i.destination_name), i.travel_month,
           count(DISTINCT i.rider_id), sum(i.party_size)::bigint, min(i.created_at), max(i.created_at)
      FROM public.escape_lane_interest i
     WHERE i.travel_month >= date_trunc('month', now() AT TIME ZONE 'America/Port_of_Spain')::date
     GROUP BY i.origin_code, i.destination_code, i.travel_month
     ORDER BY sum(i.party_size) DESC, i.travel_month ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_lane_demand() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_lane_demand() TO authenticated;
