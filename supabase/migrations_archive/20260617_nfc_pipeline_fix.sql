-- =============================================================================
-- NFC Pipeline Fix — session persistence, dispatch_queue RLS, trigger fix
-- =============================================================================
-- Fixes 4 pipeline breaks:
--   1. nfc_sessions table for interrupted flow recovery
--   2. dispatch_queue RLS policies
--   3. trigger_enqueue_order_dispatch handles NFC task types
-- =============================================================================

-- ── 1. nfc_sessions table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nfc_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tag_uid         TEXT NOT NULL,
    kiosk_id        UUID REFERENCES public.kiosk_nodes(id),
    order_id        UUID REFERENCES public.orders(id),
    ride_id         UUID REFERENCES public.rides(id),
    session_data    JSONB DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'completed', 'expired')),
    created_at      TIMESTAMPTZ DEFAULT now(),
    expires_at      TIMESTAMPTZ DEFAULT (now() + INTERVAL '30 minutes'),
    UNIQUE (user_id, tag_uid, status) WHERE status = 'active'
);

CREATE INDEX IF NOT EXISTS idx_nfc_sessions_user ON public.nfc_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_nfc_sessions_kiosk ON public.nfc_sessions(kiosk_id);
CREATE INDEX IF NOT EXISTS idx_nfc_sessions_order ON public.nfc_sessions(order_id);

COMMENT ON TABLE public.nfc_sessions IS
  'NFC tap sessions for flow recovery. Active session means user tapped a kiosk
   but has not yet completed the ride/order flow. Expires after 30 minutes.';

ALTER TABLE public.nfc_sessions ENABLE ROW LEVEL SECURITY;

-- Users can read/write their own NFC sessions
CREATE POLICY "Users manage own NFC sessions"
    ON public.nfc_sessions
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Admins can view all NFC sessions
CREATE POLICY "Admins view all NFC sessions"
    ON public.nfc_sessions
    FOR SELECT
    USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- Allow service_role inserts from edge functions (bypasses RLS)
-- Also allow the nfc_event_handler to insert sessions on behalf of users
CREATE POLICY "Edge functions manage NFC sessions"
    ON public.nfc_sessions
    FOR ALL
    USING (auth.uid() IS NULL)
    WITH CHECK (auth.uid() IS NULL);

-- ── 2. dispatch_queue RLS policies ─────────────────────────────────────────────
-- dispatch_queue is managed by edge functions (service_role), but admins need
-- SELECT to monitor dispatch in admin dashboard.

CREATE POLICY "Admins read dispatch_queue"
    ON public.dispatch_queue
    FOR SELECT
    USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );

CREATE POLICY "Admins insert dispatch_queue"
    ON public.dispatch_queue
    FOR INSERT
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );

CREATE POLICY "Admins update dispatch_queue"
    ON public.dispatch_queue
    FOR UPDATE
    USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- ── 3. Fix trigger_enqueue_order_dispatch to handle NFC task types ─────────────
-- The existing trigger checks delivery_method IN ('courier', 'laundry_pickup').
-- NFC orders with task_type in ('grocery', 'laundry', 'courier') now set
-- delivery_method = 'courier' in nfc_event_handler, so they will be picked up.
-- Also handle task_type directly for NFC orders that might have null delivery_method
-- but a dispatchable task_type.
CREATE OR REPLACE FUNCTION trigger_enqueue_order_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Trigger for: delivery_method matches courier/laundry, OR dispatchable task_type
    IF NEW.delivery_method IN ('courier', 'laundry_pickup') THEN
        INSERT INTO dispatch_queue (order_id, delivery_method, status)
        VALUES (NEW.id, NEW.delivery_method, 'pending')
        ON CONFLICT (order_id) DO NOTHING;
        RETURN NEW;
    END IF;

    -- For NFC orders: if task_type is dispatchable but delivery_method not set
    IF NEW.task_type IN ('grocery', 'laundry', 'courier')
       AND (NEW.delivery_method IS NULL OR NEW.delivery_method = '')
       AND NEW.status = 'pending' THEN
        INSERT INTO dispatch_queue (order_id, delivery_method, status)
        VALUES (NEW.id, COALESCE(NEW.delivery_method, 'courier'), 'pending')
        ON CONFLICT (order_id) DO NOTHING;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

