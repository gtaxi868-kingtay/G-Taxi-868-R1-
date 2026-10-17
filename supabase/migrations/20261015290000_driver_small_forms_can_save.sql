-- ═══════════════════════════════════════════════════════════════════
-- Driver app: Report Issue, Scout Referral and AI Strategy can save.
--
-- Before (verified live 2026-10-15): each table had a correctly scoped
-- policy but `authenticated` only had SELECT, so all three screens failed
-- on save:
--   - Report Issue      -> nfc_event_logs   (no INSERT policy either)
--   - Scout Referral    -> driver_scout_referrals
--   - Strategy Settings -> driver_ai_strategy (upsert)
--
-- After: column-limited grants for exactly what the apps write.
--   - nfc_event_logs: a signed-in user may file a BROKEN_NODE report as
--     themselves; admin RescueScreen already lists these. No other event
--     type (those come from nfc_event_handler as service_role).
--   - driver_scout_referrals: property name + phone only. status and
--     payout_amount_cents stay server-controlled (the TT$500 payout trigger
--     fires on UPDATE to 'qualified', which drivers cannot do).
--   - driver_ai_strategy: own row, the four settings.
-- ═══════════════════════════════════════════════════════════════════

-- Report Issue
DROP POLICY IF EXISTS "Users file broken node reports" ON public.nfc_event_logs;
CREATE POLICY "Users file broken node reports"
  ON public.nfc_event_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    profile_id = (SELECT auth.uid())
    AND event_type = 'BROKEN_NODE'
    AND char_length(tag_uid) <= 64
    AND pg_column_size(location_context) <= 4096
  );
GRANT INSERT (tag_uid, profile_id, event_type, location_context) ON public.nfc_event_logs TO authenticated;

-- Scout Referral (existing policy "Driver inserts own referrals" decides rows)
GRANT INSERT (driver_id, property_name, contact_phone) ON public.driver_scout_referrals TO authenticated;

-- AI Strategy (existing policy "Drivers can manage their own AI strategy")
GRANT INSERT (user_id, strategy_mode, max_distance_meters, preferred_neighborhoods, fatigue_alerts_enabled, updated_at)
  ON public.driver_ai_strategy TO authenticated;
GRANT UPDATE (user_id, strategy_mode, max_distance_meters, preferred_neighborhoods, fatigue_alerts_enabled, updated_at)
  ON public.driver_ai_strategy TO authenticated;
