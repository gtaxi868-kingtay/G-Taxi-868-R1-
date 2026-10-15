-- ═══════════════════════════════════════════════════════════════════
-- Rider ratings: make them actually save, and only for a real trip.
--
-- Before (verified live 2026-10-15, customer-journey test as a fixture rider):
--  1. RatingScreen inserts into ratings -> "permission denied for table
--     ratings": authenticated had SELECT only, no INSERT grant.
--  2. It also updates rides.rating -> "permission denied for table rides",
--     and the only rider UPDATE policy on rides allows nothing but
--     cancelling, so that write could never work either.
--  3. The app ignores both errors and shows success. 0 ratings have ever
--     been stored; every driver's rating is untouched by real riders.
--  4. The existing INSERT policy only checked rider_id = auth.uid(): once a
--     grant existed, any rider could rate ANY driver for ANY ride, any
--     number of times.
--
-- After:
--  - authenticated may INSERT into ratings, but only for their own ride,
--    naming that ride's actual driver, once the trip has finished.
--  - One rating per ride per rider (unique index; table is empty).
--  - The rides.rating copy is written by a trigger on the ratings insert,
--    so the already-installed rider app works with no rebuild (its own
--    rides update still fails harmlessly and is ignored by the app).
-- ═══════════════════════════════════════════════════════════════════

-- 1. One rating per ride per rider.
CREATE UNIQUE INDEX IF NOT EXISTS ratings_one_per_ride_rider
  ON public.ratings (ride_id, rider_id);

-- 2. Only a finished ride, by its own rider, for its actual driver.
DROP POLICY IF EXISTS "Users can insert their own ratings" ON public.ratings;
CREATE POLICY "Riders rate their own finished ride"
  ON public.ratings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    rider_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.rides r
      WHERE r.id = ratings.ride_id
        AND r.rider_id = (SELECT auth.uid())
        AND r.driver_id = ratings.driver_id
        AND r.status IN ('completed', 'payment_confirmed', 'closed')
    )
  );

GRANT INSERT ON public.ratings TO authenticated;

-- 3. Copy the score onto the ride (riders cannot update rides directly).
CREATE OR REPLACE FUNCTION public.copy_rating_to_ride()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  UPDATE public.rides
     SET rating = NEW.rating
   WHERE id = NEW.ride_id
     AND rider_id = NEW.rider_id;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.copy_rating_to_ride() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_copy_rating_to_ride ON public.ratings;
CREATE TRIGGER trg_copy_rating_to_ride
  AFTER INSERT ON public.ratings
  FOR EACH ROW
  EXECUTE FUNCTION public.copy_rating_to_ride();
