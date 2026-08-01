-- =============================================================================
-- P0 HOTFIX (found 2026-07-14): trigger_set_ride_arrived_at broke EVERY update
-- to public.rides.
--
-- The live function body was:
--     UPDATE rides SET arrived_at = NOW() WHERE id = NEW.ride_id;
-- attached as  BEFORE UPDATE ON public.rides FOR EACH ROW.
-- `rides` has no `ride_id` column, so every UPDATE on rides raised
--     ERROR: record "new" has no field "ride_id"
-- Confirmed live: 0 rides updated in the 7 days before this fix; the last
-- successful ride update was 2026-06-20 — i.e. ride completion / cancellation /
-- status changes (complete_ride, cancel_ride, accept flows, the new scout &
-- mark-safe triggers) had all been silently failing in production since then.
--
-- The body was almost certainly copy-pasted from a trigger meant for a table
-- whose NEW row has a `ride_id` (e.g. ride_events). On `rides` itself, a
-- BEFORE-UPDATE trigger should stamp arrived_at directly on NEW when the ride
-- transitions into 'arrived' — no self-UPDATE (which would also recurse),
-- no nonexistent column. This restores the evident intent and unbreaks all
-- ride updates.
--
-- Reversibility: to restore the exact previous (broken) definition, replace the
-- body below with `UPDATE rides SET arrived_at = NOW() WHERE id = NEW.ride_id;`.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_ride_arrived_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  -- Stamp arrival time once, on the transition into 'arrived'. BEFORE trigger:
  -- mutate NEW directly — no second UPDATE, no recursion.
  IF NEW.status = 'arrived'
     AND OLD.status IS DISTINCT FROM 'arrived'
     AND NEW.arrived_at IS NULL THEN
    NEW.arrived_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger definition itself is unchanged (BEFORE UPDATE ON rides FOR EACH ROW);
-- only the function body is corrected, so no DROP/CREATE TRIGGER needed.
