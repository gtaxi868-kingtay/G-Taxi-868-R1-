-- ═══════════════════════════════════════════════════════════════════
-- A suspended or blocked customer cannot book rides or place orders.
--
-- Before (verified live 2026-10-15): admin "Suspend rider" sets
-- profiles.suspended, but nothing anywhere reads it; profiles.
-- platform_blocked is only checked for drivers (requireDriver). A
-- suspended rider could keep booking rides and placing orders.
--
-- After: BEFORE INSERT on rides and orders refuses the row when the
-- customer's profile is suspended or platform_blocked, whatever path
-- creates it (create_ride, grocery, laundry, merchant dispatch...).
-- Existing rides/orders are untouched.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.refuse_suspended_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.rider_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.profiles p
        WHERE p.id = NEW.rider_id
          AND (COALESCE(p.suspended, false) OR COALESCE(p.platform_blocked, false))) THEN
    RAISE EXCEPTION 'ACCOUNT_SUSPENDED: this account is suspended. Contact support.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.refuse_suspended_customer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_refuse_suspended_customer ON public.rides;
CREATE TRIGGER trg_refuse_suspended_customer
  BEFORE INSERT ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.refuse_suspended_customer();

DROP TRIGGER IF EXISTS trg_refuse_suspended_customer ON public.orders;
CREATE TRIGGER trg_refuse_suspended_customer
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.refuse_suspended_customer();
