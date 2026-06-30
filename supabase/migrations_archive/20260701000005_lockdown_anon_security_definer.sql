-- HARDENED CORE — Phase A: remove ANONYMOUS access to SECURITY DEFINER RPCs.
--
-- Problem (verified via Supabase advisor 2026-07-01): every SECURITY DEFINER
-- function in `public` is granted EXECUTE to PUBLIC, so 84 of them are callable
-- by the `anon` role — i.e. by anyone holding the public anon key, with no
-- login. Many bypass RLS and perform privileged writes (e.g.
-- capture_escape_wipay_payment marks a reservation CAPTURED with no payment
-- check because it trusts its caller). This is a privilege-escalation surface.
--
-- Phase A closes the ANONYMOUS hole only, with zero impact on logged-in users:
--   REVOKE EXECUTE FROM PUBLIC, anon   -> anonymous callers blocked
--   GRANT  EXECUTE TO authenticated    -> preserves ALL current logged-in flows
--   GRANT  EXECUTE TO service_role     -> preserves ALL edge-function calls
--
-- Phase B (separate, tested migration) will tighten `authenticated` down to the
-- ~32-RPC client allowlist. We do NOT do that here because functions referenced
-- by RLS policies / nested SECURITY DEFINER calls need per-function review.
--
-- Reversible: re-GRANT EXECUTE ... TO anon restores prior behavior.
-- Extension-owned functions are skipped (deptype 'e') to avoid breaking pgsodium/vault/etc.

DO $$
DECLARE
  r        RECORD;
  n_locked INTEGER := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.deptype = 'e'   -- skip extension-owned
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
    n_locked := n_locked + 1;
  END LOOP;

  RAISE NOTICE 'Phase A lockdown: anon EXECUTE revoked on % SECURITY DEFINER functions', n_locked;
END $$;
