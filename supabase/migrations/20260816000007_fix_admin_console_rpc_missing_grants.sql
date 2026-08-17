-- Phase 3 monorepo audit (2026-08-16) found 10 admin-console RPCs called
-- directly via supabase.rpc(...) from apps/admin (Pricing.tsx,
-- EscapeManagement.tsx, RevshareSettlement.tsx, WarChest.tsx,
-- NodeRegistry.tsx, MerchantNetwork.tsx, FleetManager.tsx) that had ZERO
-- EXECUTE grant to `authenticated` -- confirmed live via
-- has_function_privilege('authenticated', ..., 'execute') = false for
-- all 10, including admin_set_pricing which the audit agent had
-- mistakenly reported as working (re-verified: it does not).
--
-- Same root cause as project_rpc_lockdown.md's 2026-06-24 SECURITY
-- DEFINER grant lockdown: every one of these functions already has a
-- correct internal `profiles.role = 'admin'` guard (RAISE EXCEPTION
-- 'Unauthorized' otherwise) -- confirmed by reading each function body
-- live before this migration -- so granting EXECUTE to `authenticated`
-- does not open them to non-admins, it just lets the guard run at all
-- instead of the call dying at the PostgREST layer with 42501 first.
--
-- admin_create_driver_loan (WarChest.tsx) is NOT included here -- it
-- doesn't exist in the DB at all, and is a genuine schema/product
-- mismatch (see project_phase3_remaining_gaps.md), not a missing grant.
GRANT EXECUTE ON FUNCTION public.admin_create_surge_zone(double precision, double precision, integer, numeric, text, timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_deactivate_surge_zone(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_surge_zones() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_escape_action(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_escape_action(uuid, text, timestamp with time zone, timestamp with time zone, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_organizer_banks(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_organizer_bank(uuid, text, text, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_reserve_balance() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_surge_zone(double precision, double precision, double precision, numeric, timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_node(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_merchant_billing(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_driver_lease(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_pricing(text, integer) TO authenticated;
