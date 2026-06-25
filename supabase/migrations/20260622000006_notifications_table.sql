-- Notifications — in-app notification feed for riders
--
-- ── RATIONALE ────────────────────────────────────────────────────────────────
-- The rider app ships a NotificationsScreen and a bell with an unread badge, but
-- there was no backing store. This adds the table, RLS, and the emit points.
--
-- ALTITUDE DECISION: rather than scatter notification INSERTs across four edge
-- functions (accept_ride, update_ride_status, complete_ride, stripe_webhook) we
-- emit from a single AFTER UPDATE trigger on `rides`. The ride state machine is
-- the source of truth; the trigger fires once per real transition and cannot be
-- forgotten when a new code path moves a ride. G-Escape confirmations come from
-- an equivalent trigger on `package_reservations`. Adding a new notification kind
-- means one helper call, not a new cross-function convention.
--
-- ── RLS (per CLAUDE.md) ──────────────────────────────────────────────────────
--   SELECT: own rows only
--   UPDATE: own rows, is_read column only (column-level GRANT enforces the column;
--           RLS USING/WITH CHECK enforces ownership)
--   INSERT: service role / SECURITY DEFINER helpers only — never the client
--   DELETE: no policy → denied for users
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Table ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL DEFAULT 'system'
                CHECK (type IN ('ride','payment','promo','escape','grocery','laundry','system')),
    title       TEXT NOT NULL,
    body        TEXT,
    is_read     BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Matches the client query: WHERE user_id = ? AND is_read = false ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread_created
    ON public.notifications (user_id, is_read, created_at DESC);

-- 2. RLS -----------------------------------------------------------------------
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own notifications read" ON public.notifications;
CREATE POLICY "Own notifications read" ON public.notifications
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Own notifications mark read" ON public.notifications;
CREATE POLICY "Own notifications mark read" ON public.notifications
    FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role full access notifications" ON public.notifications;
CREATE POLICY "Service role full access notifications" ON public.notifications
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 3. Column-level privileges ---------------------------------------------------
-- Clients may read, and may only ever write the is_read flag. No INSERT/DELETE.
REVOKE ALL ON public.notifications FROM anon, authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (is_read) ON public.notifications TO authenticated;

-- 4. Emit helper ---------------------------------------------------------------
-- SECURITY DEFINER so it can INSERT regardless of the caller's row privileges.
CREATE OR REPLACE FUNCTION public.notify_user(
    p_user_id UUID,
    p_type    TEXT,
    p_title   TEXT,
    p_body    TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_user_id IS NULL OR p_title IS NULL THEN
        RETURN;
    END IF;
    INSERT INTO public.notifications (user_id, type, title, body)
    VALUES (p_user_id, COALESCE(p_type, 'system'), p_title, p_body);
END;
$$;

REVOKE ALL ON FUNCTION public.notify_user(UUID, TEXT, TEXT, TEXT) FROM anon, authenticated;

-- 5. Ride lifecycle trigger ----------------------------------------------------
-- Fires on real status / payment_status transitions only.
CREATE OR REPLACE FUNCTION public.emit_ride_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Status transitions the rider should hear about
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.status = 'assigned' THEN
            PERFORM public.notify_user(NEW.rider_id, 'ride',
                'Driver assigned', 'Your driver is on the way.');
        ELSIF NEW.status = 'arrived' THEN
            PERFORM public.notify_user(NEW.rider_id, 'ride',
                'Driver has arrived', 'Your driver is waiting at the pickup point.');
        ELSIF NEW.status = 'completed' THEN
            PERFORM public.notify_user(NEW.rider_id, 'ride',
                'Trip complete', 'Thanks for riding with G-Taxi.');
        END IF;
    END IF;

    -- Payment capture
    IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
       AND NEW.payment_status IN ('captured','confirmed') THEN
        PERFORM public.notify_user(NEW.rider_id, 'payment',
            'Payment received', 'Your receipt is ready in Trips.');
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_emit_ride_notification ON public.rides;
CREATE TRIGGER trg_emit_ride_notification
    AFTER UPDATE OF status, payment_status ON public.rides
    FOR EACH ROW
    EXECUTE FUNCTION public.emit_ride_notification();

-- 6. G-Escape confirmation trigger ---------------------------------------------
CREATE OR REPLACE FUNCTION public.emit_escape_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.status = 'CAPTURED' THEN
            PERFORM public.notify_user(NEW.rider_id, 'escape',
                'Booking secured', 'Your G-Escape seats are held. We''ll confirm once the flight locks in.');
        ELSIF NEW.status = 'CONFIRMED' THEN
            PERFORM public.notify_user(NEW.rider_id, 'escape',
                'Escape confirmed', 'Your Caribbean getaway is confirmed. Check My Bookings for details.');
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_emit_escape_notification ON public.package_reservations;
CREATE TRIGGER trg_emit_escape_notification
    AFTER UPDATE OF status ON public.package_reservations
    FOR EACH ROW
    EXECUTE FUNCTION public.emit_escape_notification();
