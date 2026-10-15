-- ═══════════════════════════════════════════════════════════════════
-- Admin Rescue screen can mark a broken-node report as resolved.
--
-- Before (verified live 2026-10-15): "Mark Resolved" sent a manage_nodes
-- action that does not exist (and swallowed the error), so reports could
-- never be cleared. nfc_event_logs had no admin write access.
--
-- After: admins may update result_payload only (where the resolution is
-- recorded, e.g. {"resolved": true, "resolved_by": ..., "resolved_at": ...}).
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Admins resolve node reports" ON public.nfc_event_logs;
CREATE POLICY "Admins resolve node reports" ON public.nfc_event_logs
  FOR UPDATE TO authenticated
  USING (public.auth_is_admin())
  WITH CHECK (public.auth_is_admin());
GRANT UPDATE (result_payload) ON public.nfc_event_logs TO authenticated;
