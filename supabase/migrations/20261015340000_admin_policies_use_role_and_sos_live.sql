-- ═══════════════════════════════════════════════════════════════════
-- Admins can actually see what is addressed to them; SOS pops up live.
--
-- Before (verified live 2026-10-15):
--  - Six admin policies check profiles.is_admin = true, but every admin
--    account has role = 'admin' and is_admin = false. So admins could not
--    see support tickets (incl. safety reports), payout requests, driver
--    documents, bank accounts, promos, or inactive surge zones.
--  - system_alerts (where SOS lands) is not in the realtime publication,
--    so the admin SOS screen only showed a new SOS after a manual reload.
--
-- After:
--  - Those six policies use role = 'admin' (same test every other admin
--    policy here uses). Table grants are unchanged, so this widens what an
--    admin can READ; writes still go through the admin edge function.
--  - system_alerts added to supabase_realtime. Realtime respects RLS: only
--    the existing "Admins can read system_alerts" policy lets rows through.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Admins manage promos" ON public.admin_promos;
CREATE POLICY "Admins manage promos" ON public.admin_promos
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'::user_role));

DROP POLICY IF EXISTS "Admins can view all bank accounts" ON public.bank_accounts;
CREATE POLICY "Admins can view all bank accounts" ON public.bank_accounts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'::user_role));

DROP POLICY IF EXISTS "Admins full access docs" ON public.driver_documents;
CREATE POLICY "Admins full access docs" ON public.driver_documents
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'::user_role));

DROP POLICY IF EXISTS "Admins full access payouts" ON public.payout_requests;
CREATE POLICY "Admins full access payouts" ON public.payout_requests
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'::user_role));

DROP POLICY IF EXISTS "Admins full access surge" ON public.pricing_zones;
CREATE POLICY "Admins full access surge" ON public.pricing_zones
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'::user_role));

DROP POLICY IF EXISTS "Admins can manage all tickets" ON public.support_tickets;
CREATE POLICY "Admins can manage all tickets" ON public.support_tickets
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'::user_role));

DO $pub$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                  WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'system_alerts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.system_alerts;
  END IF;
END
$pub$;
