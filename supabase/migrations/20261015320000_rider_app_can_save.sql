-- ═══════════════════════════════════════════════════════════════════
-- Rider app: the rider's own settings and details can actually be saved.
--
-- Before (verified live 2026-10-15): every table below already had an
-- "own rows" policy, but `authenticated` had SELECT only, so each save
-- failed with "permission denied" (or silently):
--   profiles            Edit Profile, emergency contact (the SOS contact),
--                       phone at sign-up, and the push-notification token
--                       (so no rider could receive a push)
--   saved_places        save / delete a place
--   rider_ai_preferences AI settings toggles
--   notifications       mark as read
--   band_members        join a carnival band
--   user_events         G-Member waitlist "Reserve my spot"
--   passenger_details   G-Escape passport form (no write policy at all)
--   notification_settings  table did not exist
--
-- After: grants limited to the columns the apps write. Nothing a rider
-- should not control is grantable: on profiles that excludes role,
-- is_admin, wallet_balance, suspended, subscription_*, g_member_active,
-- referral fields, platform_blocked*, territory_id, merchant_id, etc.
-- "Cancel membership" (subscription_tier -> free) goes through a function
-- so riders cannot set themselves to a paid tier.
-- ═══════════════════════════════════════════════════════════════════

-- profiles (policy "Own profile update": id = auth.uid())
GRANT UPDATE (full_name, phone_number, avatar_url, emergency_contact_name,
              emergency_contact_phone, push_token, notification_enabled, updated_at)
  ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.rider_cancel_g_membership()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  UPDATE public.profiles
     SET subscription_tier = 'free'::rider_subscription_tier, updated_at = now()
   WHERE id = auth.uid();
  RETURN jsonb_build_object('success', FOUND);
END;
$function$;
REVOKE ALL ON FUNCTION public.rider_cancel_g_membership() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rider_cancel_g_membership() TO authenticated;

-- saved_places (own rows; upsert on (user_id, label))
GRANT INSERT (user_id, label, address, lat, lng, icon) ON public.saved_places TO authenticated;
GRANT UPDATE (user_id, label, address, lat, lng, icon) ON public.saved_places TO authenticated;
GRANT DELETE ON public.saved_places TO authenticated;

-- rider_ai_preferences (own row; upsert on user_id)
GRANT INSERT (user_id, quiet_ride, pace_priority, route_avoidance, ai_suggestions_enabled, memory_enabled, updated_at)
  ON public.rider_ai_preferences TO authenticated;
GRANT UPDATE (user_id, quiet_ride, pace_priority, route_avoidance, ai_suggestions_enabled, memory_enabled, updated_at)
  ON public.rider_ai_preferences TO authenticated;

-- notifications (policy "Own notifications mark read")
GRANT UPDATE (is_read) ON public.notifications TO authenticated;

-- band_members (policy "Users can join a band": rider_id = auth.uid())
GRANT INSERT (rider_id, band_id) ON public.band_members TO authenticated;

-- user_events: riders may only file the G-Member waitlist request
-- themselves; every other event type is written by edge functions.
DROP POLICY IF EXISTS "Users insert own events" ON public.user_events;
CREATE POLICY "Users insert own events"
  ON public.user_events
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND event_type = 'g_member_waitlist');
GRANT INSERT (user_id, event_type, payload) ON public.user_events TO authenticated;

-- passenger_details: a rider fills in their own travel documents, only for
-- an Escape booking that is theirs.
DROP POLICY IF EXISTS "passenger_own_write" ON public.passenger_details;
CREATE POLICY "passenger_own_write"
  ON public.passenger_details
  FOR INSERT
  TO authenticated
  WITH CHECK (
    rider_id = (SELECT auth.uid())
    AND participant_id IN (SELECT p.id FROM public.escape_group_participants p WHERE p.rider_id = (SELECT auth.uid()))
  );
DROP POLICY IF EXISTS "passenger_own_update" ON public.passenger_details;
CREATE POLICY "passenger_own_update"
  ON public.passenger_details
  FOR UPDATE
  TO authenticated
  USING (rider_id = (SELECT auth.uid()) AND verified_at IS NULL)
  WITH CHECK (
    rider_id = (SELECT auth.uid())
    AND participant_id IN (SELECT p.id FROM public.escape_group_participants p WHERE p.rider_id = (SELECT auth.uid()))
  );
GRANT INSERT (participant_id, rider_id, full_name, date_of_birth, gender, nationality, passport_number,
              passport_expiry, passport_issuance_date, passport_issuance_location, birth_place, email,
              phone_country_code, phone_number, emergency_name, emergency_phone)
  ON public.passenger_details TO authenticated;
GRANT UPDATE (participant_id, rider_id, full_name, date_of_birth, gender, nationality, passport_number,
              passport_expiry, passport_issuance_date, passport_issuance_location, birth_place, email,
              phone_country_code, phone_number, emergency_name, emergency_phone)
  ON public.passenger_details TO authenticated;

-- notification_settings: the Settings screen's two switches. Stored per
-- rider. NOTE: no sender reads this yet (there are no promo pushes today).
CREATE TABLE IF NOT EXISTS public.notification_settings (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ride_updates boolean NOT NULL DEFAULT true,
  promotions  boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own notification settings" ON public.notification_settings;
CREATE POLICY "Own notification settings"
  ON public.notification_settings
  FOR ALL
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.notification_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notification_settings TO authenticated;
