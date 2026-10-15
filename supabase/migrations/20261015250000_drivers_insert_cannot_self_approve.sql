-- ═══════════════════════════════════════════════════════════════════
-- Driver sign-up cannot create an already-approved / privileged driver.
--
-- Before (verified live 2026-10-15): authenticated may INSERT every column
-- of drivers (policy only checks user_id = auth.uid()), and
-- protect_driver_sensitive_columns runs on UPDATE only. Any signed-in user
-- could create their own driver row already verified, with a custom
-- commission rate, a large credit limit, a 5.0 rating, a chosen network
-- recruiter, etc.
--
-- After: for anyone except service_role, a BEFORE INSERT trigger resets
-- every protected column to its safe default. The driver app's sign-up
-- (RegisterScreen: name, phone, vehicle, plate, type, offline, and
-- verified_status 'pending') is unaffected. Server-side flows
-- (register_driver_with_code, admin approval) run as service_role.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.protect_driver_sensitive_columns_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  NEW.verified_status := CASE WHEN NEW.verified_status::text IN ('unverified', 'pending')
                              THEN NEW.verified_status ELSE 'unverified'::driver_verified_status END;
  NEW.is_verified                    := false;
  NEW.commission_tier                := 'standard'::driver_commission_tier;
  NEW.custom_commission_rate         := NULL;
  NEW.is_bot                         := false;
  NEW.fleet_lease_id                 := NULL;
  NEW.region_id                      := NULL;
  NEW.spoof_flag_count               := 0;
  NEW.spoof_flagged_at               := NULL;
  NEW.spoof_suspended                := false;
  NEW.acceptance_rate                := 0.80;
  NEW.credit_limit_cents             := 60000;
  NEW.credit_used_cents              := 0;
  NEW.rating                         := NULL;
  NEW.rating_count                   := 0;
  NEW.rank                           := 'driver'::driver_rank;
  NEW.registration_class             := 'unverified';
  NEW.registration_verified_at       := NULL;
  NEW.registration_verified_by       := NULL;
  NEW.recruited_by_commander_user_id := NULL;
  NEW.recruited_at                   := NULL;
  NEW.territory_id                   := NULL;
  NEW.territory_joined_at            := NULL;
  NEW.is_online                      := false;
  NEW.status                         := 'offline';
  NEW.active_ride_id                 := NULL;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.protect_driver_sensitive_columns_on_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_driver_sensitive_columns_insert ON public.drivers;
CREATE TRIGGER trg_protect_driver_sensitive_columns_insert
  BEFORE INSERT ON public.drivers
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_driver_sensitive_columns_on_insert();
