-- ═══════════════════════════════════════════════════════════════════
-- In-ride chat: rider and driver can actually send messages.
--
-- Before (verified live 2026-10-15): ride_messages had an INSERT policy but
-- `authenticated` only had SELECT, so every send in both apps failed
-- ("Failed to send message"). The policies also compared rides.driver_id
-- (a drivers.id) with auth.uid(), which only works while those happen to
-- match, and did not check sender_id, so a participant could post as the
-- other person, on any of their past rides.
--
-- After:
--  - Read: the ride's rider, or the driver whose drivers.user_id is caller.
--  - Send: same people, as themselves only (sender_id = auth.uid()), only
--    while the ride is live (assigned / arrived / in_progress), text up to
--    1000 characters.
--  - INSERT granted on exactly the columns the apps write.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Users can view messages for their rides" ON public.ride_messages;
CREATE POLICY "Users can view messages for their rides"
  ON public.ride_messages
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.rides r
     WHERE r.id = ride_messages.ride_id
       AND (r.rider_id = (SELECT auth.uid())
            OR r.driver_id IN (SELECT d.id FROM public.drivers d WHERE d.user_id = (SELECT auth.uid())))
  ));

DROP POLICY IF EXISTS "Users can send messages to their active rides" ON public.ride_messages;
CREATE POLICY "Users can send messages to their active rides"
  ON public.ride_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = (SELECT auth.uid())
    AND char_length(content) BETWEEN 1 AND 1000
    AND EXISTS (
      SELECT 1 FROM public.rides r
       WHERE r.id = ride_messages.ride_id
         AND r.status IN ('assigned', 'arrived', 'in_progress')
         AND (r.rider_id = (SELECT auth.uid())
              OR r.driver_id IN (SELECT d.id FROM public.drivers d WHERE d.user_id = (SELECT auth.uid())))
    )
  );

GRANT INSERT (ride_id, sender_id, content, type) ON public.ride_messages TO authenticated;
