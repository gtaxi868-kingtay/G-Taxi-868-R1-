-- ═══════════════════════════════════════════════════════════════════
-- Admin can see driver records (compliance queue, fleet, dashboards).
--
-- Before (verified live 2026-10-15): drivers had no admin read policy
-- (only own row, a rider's active driver, service_role). ComplianceReview
-- embeds drivers!inner, so every submitted document was dropped from the
-- admin's queue; admin realtime on drivers delivered nothing.
--
-- After: admins (auth_is_admin()) may read drivers. Writes unchanged
-- (admin edits still go through the admin edge function).
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Admins read drivers" ON public.drivers;
CREATE POLICY "Admins read drivers" ON public.drivers
  FOR SELECT TO authenticated USING (public.auth_is_admin());
