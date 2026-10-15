-- ═══════════════════════════════════════════════════════════════════
-- Admin web pages can save the settings they edit, and see what they list.
--
-- Before (verified live 2026-10-15): these tables already had an
-- admin-only write policy (role = 'admin') but `authenticated` had SELECT
-- only, so every admin save failed or silently did nothing:
--   driver_zone_rates      Escape zone payout editor
--   pricing_zones          WarChest "Deactivate surge"
--   g_knowledge_documents  G Memory upload / deactivate / delete
--   agent_decision_log     audit rows written by Progression edits
--   driver_leases          Fleet "Reject lease"
-- progression_config / rider_progression had NO admin policy at all
-- (Progression "Save rule" / manual unlock), and group_booking_alerts,
-- referral_earnings, vehicle_sales, vehicle_inventory had no admin read
-- policy (Escape alerts, WarChest referral payouts, Dealer pipeline and
-- sold/reserved inventory showed empty).
--
-- After: table grants added only where every write policy is admin-only,
-- so non-admins gain nothing (RLS still refuses them); admin policies
-- added where missing, using auth_is_admin().
-- ═══════════════════════════════════════════════════════════════════

-- Writes: existing policies already admin-only.
GRANT INSERT, UPDATE, DELETE ON public.driver_zone_rates     TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.pricing_zones         TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.g_knowledge_documents TO authenticated;
GRANT INSERT                 ON public.agent_decision_log    TO authenticated;
GRANT UPDATE                 ON public.driver_leases         TO authenticated;

-- Progression: admin manages rules and rider levels.
DROP POLICY IF EXISTS "Admins manage progression config" ON public.progression_config;
CREATE POLICY "Admins manage progression config" ON public.progression_config
  FOR ALL TO authenticated USING (public.auth_is_admin()) WITH CHECK (public.auth_is_admin());
GRANT INSERT, UPDATE ON public.progression_config TO authenticated;

DROP POLICY IF EXISTS "Admins manage rider progression" ON public.rider_progression;
CREATE POLICY "Admins manage rider progression" ON public.rider_progression
  FOR ALL TO authenticated USING (public.auth_is_admin()) WITH CHECK (public.auth_is_admin());
GRANT UPDATE ON public.rider_progression TO authenticated;

-- Admin read access for lists that were empty.
DROP POLICY IF EXISTS "Admins read booking alerts" ON public.group_booking_alerts;
CREATE POLICY "Admins read booking alerts" ON public.group_booking_alerts
  FOR SELECT TO authenticated USING (public.auth_is_admin());

DROP POLICY IF EXISTS "Admins read referral earnings" ON public.referral_earnings;
CREATE POLICY "Admins read referral earnings" ON public.referral_earnings
  FOR SELECT TO authenticated USING (public.auth_is_admin());

DROP POLICY IF EXISTS "Admins read vehicle sales" ON public.vehicle_sales;
CREATE POLICY "Admins read vehicle sales" ON public.vehicle_sales
  FOR SELECT TO authenticated USING (public.auth_is_admin());

DROP POLICY IF EXISTS "Admins read vehicle inventory" ON public.vehicle_inventory;
CREATE POLICY "Admins read vehicle inventory" ON public.vehicle_inventory
  FOR SELECT TO authenticated USING (public.auth_is_admin());
