-- ═══════════════════════════════════════════════════════════════════
-- Fix driver sign-up: no new driver could ever join.
--
-- 1. drivers.id has no default, and both sign-up paths insert without
--    it -- the driver app's RegisterScreen (direct insert) and
--    register_driver_with_code (the "join with a code" edge function).
--    Every attempt failed: null value in column "id". The account was
--    created but never became a driver. Found 2026-10-13 while creating
--    Phase 2 test fixtures; only 1 real driver row exists.
--    Fix: on insert, a missing id becomes the user's own id -- the
--    convention the existing driver row already follows, and what
--    driver_documents' own-row policy and enforce_phone_uniqueness's
--    self-exclusion both assume. Named aa_ so it fires before the other
--    BEFORE INSERT triggers (sync_driver_location, phone uniqueness),
--    which read NEW.id. Fixes already-installed app builds too: no app
--    release needed.
--
-- 2. driver_documents had an own-row INSERT policy but authenticated held
--    only SELECT, so licence/permit/vehicle document rows were always
--    refused -- and RegisterScreen ignores that error, telling the
--    applicant "Application submitted" while their documents were lost.
--    RLS still limits inserts to driver_id = auth.uid().
--
-- Proven (rolled back, live DB): applicant's driver row saves with
-- id = user id; 3 documents save; a different user is refused adding
-- documents to that driver; the join-with-code (service role) insert
-- saves. Admin review reads documents via service-role edge functions,
-- unaffected. (Separately noted: the "Admins full access docs" policy
-- checks profiles.is_admin, which no admin has set -- unused, harmless.)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.drivers_default_id_from_user_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  NEW.id := COALESCE(NEW.id, NEW.user_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS aa_drivers_default_id_from_user_id ON public.drivers;
CREATE TRIGGER aa_drivers_default_id_from_user_id
  BEFORE INSERT ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.drivers_default_id_from_user_id();

GRANT INSERT ON public.driver_documents TO authenticated;
