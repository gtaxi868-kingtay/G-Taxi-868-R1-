-- Found via a Phase-3-style audit of driver safety/reliability flows.
-- Three stacked bugs meant no driver could ever successfully go online
-- through the app's own code path (AuthContext.tsx toggleOnline does a
-- direct client `.from('drivers').update(...)`):
--
-- 1. `authenticated` had only SELECT on public.drivers -- no INSERT, no
--    UPDATE at all. The RLS policies "Drivers update own status" and
--    "Allow driver self registration" (both correctly scoped to
--    user_id = auth.uid()) were completely dead: Postgres blocks the
--    write before RLS is even evaluated when the role lacks the base
--    table privilege. Confirmed live via information_schema.role_table_
--    grants. Same root cause class as project_rpc_lockdown's
--    "RLS policies alone guarantee nothing -- check GRANTs too."
-- 2. Even after fixing #1, a second block appeared: the
--    trigger_enforce_debt trigger (BEFORE UPDATE OF is_online, fires
--    enforce_driver_debt_limit()) is plain plpgsql (not SECURITY
--    DEFINER), so it runs with the CALLING role's privileges --
--    including its inner call to check_driver_debt_limit(), which is
--    SECURITY DEFINER but grantable only to service_role/postgres.
--    Postgres requires EXECUTE on a function to even call it,
--    regardless of what SECURITY DEFINER does once inside -- so this
--    always failed with "permission denied for function
--    check_driver_debt_limit" for any real authenticated driver.
--    Fixed by making the trigger wrapper itself SECURITY DEFINER
--    (matching this codebase's established internal-bridging pattern,
--    e.g. protect_driver_sensitive_columns) rather than exposing the
--    debt-check function directly to clients.
-- 3. Even after #1 and #2, the debt check itself was silently broken:
--    enforce_driver_debt_limit() called check_driver_debt_limit(NEW.id)
--    -- NEW.id is drivers.id, a separate generated key, not the driver's
--    auth id -- while check_driver_debt_limit queries
--    wallet_transactions.user_id, which is keyed by the auth id
--    (drivers.user_id). For any driver where id != user_id (i.e. every
--    real driver not created with a coincidentally-matching UUID), the
--    debt lookup always returned zero owed regardless of actual debt --
--    the $300 TTD debt lock had never actually been enforced. Fixed to
--    pass NEW.user_id.
--
-- Dry-run verified live, both directions: a driver with no debt
-- successfully toggles online; a driver with $350 TTD in pending
-- commission_debt is correctly blocked with the real error message.
-- Live-verified end-to-end through the real client call path (direct
-- PostgREST PATCH with a real driver JWT, exactly matching AuthContext.
-- tsx's toggleOnline): 200 OK, is_online correctly flipped to true --
-- first successful "go online" through this path in the app's history.
GRANT INSERT, UPDATE ON public.drivers TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_driver_debt_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF NEW.is_online = true AND NOT public.check_driver_debt_limit(NEW.user_id) THEN
        RAISE EXCEPTION 'Debt limit exceeded. Please settle outstanding commission ($300 TTD limit).';
    END IF;
    RETURN NEW;
END;
$function$;
