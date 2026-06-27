-- DAY-1 SEV1: infinite recursion in rides RLS.
--   rides   policy "Drivers can view offered rides" subqueries ride_offers, and
--   ride_offers policy "Riders see offers on their rides" subqueries rides
--   -> evaluating either re-evaluates the other forever.
-- Effect: ANY direct client SELECT on rides errors with 42P17, and Supabase
-- Realtime ride subscriptions (which evaluate RLS per subscriber) fail. Live
-- ride tracking is broken for real users. (Edge functions use service_role,
-- whose "Service role full access rides" USING(true) policy short-circuits, so
-- this was invisible until a client read rides directly.)
--
-- Fix (standard Supabase pattern): replace the cross-table inline subqueries
-- with STABLE SECURITY DEFINER helpers that bypass the other table's RLS, so the
-- cycle can't form. Scope the two rewritten policies to `authenticated` (they
-- rely on auth.uid(); anon never matched anyway and would otherwise hit a
-- function-execute check).

CREATE OR REPLACE FUNCTION public.rider_ride_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.rides WHERE rider_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.driver_offered_ride_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ro.ride_id
  FROM public.ride_offers ro
  JOIN public.drivers d ON d.id = ro.driver_id
  WHERE d.user_id = auth.uid()
$$;

REVOKE EXECUTE ON FUNCTION public.rider_ride_ids()         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.driver_offered_ride_ids() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rider_ride_ids()         TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.driver_offered_ride_ids() TO authenticated, service_role;

-- Break the cycle on the rides side
DROP POLICY IF EXISTS "Drivers can view offered rides" ON public.rides;
CREATE POLICY "Drivers can view offered rides" ON public.rides
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.driver_offered_ride_ids()));

-- ...and on the ride_offers side
DROP POLICY IF EXISTS "Riders see offers on their rides" ON public.ride_offers;
CREATE POLICY "Riders see offers on their rides" ON public.ride_offers
  FOR SELECT TO authenticated
  USING (ride_id IN (SELECT public.rider_ride_ids()));
