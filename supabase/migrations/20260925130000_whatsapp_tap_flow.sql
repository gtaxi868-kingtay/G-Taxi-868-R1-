-- WhatsApp tap-to-ride flow (founder-confirmed 25 Sep 2026)
-- ============================================================================
-- A stranger taps an NFC puck / scans a QR with no app and no account, lands
-- on tap.html, and books the whole ride inside WhatsApp:
--   tap -> WhatsApp prefill (GTAXI TAP <node_id>) -> destination -> fare quote
--   -> selfie -> server-side dispatch -> PIN + plate -> driver completes ->
--   app invite.
--
-- This migration is ADDITIVE only:
--   1. whatsapp_conversations  — one row per rider phone number's active flow
--   2. whatsapp_processed_messages — Meta message-id dedupe (idempotency)
--   3. rides.origin ('app' default; 'whatsapp' for tap-to-ride rides)
--   4. storage bucket ride-selfies (private; service-role writes)
--   5. trigger notify_whatsapp_ride_event: on rides.status -> assigned/completed
--      for WhatsApp-origin rides, pg_net POSTs to the whatsapp_webhook
--      /events/* endpoint. The endpoint re-reads the ride from the DB and only
--      acts when the status genuinely matches, so the unsigned internal call
--      cannot forge a state transition.
-- ============================================================================

-- 1. Conversations ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    phone_number text NOT NULL,
    node_id uuid REFERENCES public.kiosk_nodes(id) ON DELETE SET NULL,
    state text NOT NULL DEFAULT 'TAP_RECEIVED',
    pickup_lat double precision,
    pickup_lng double precision,
    pickup_name text,
    pickup_address text,
    dest_lat double precision,
    dest_lng double precision,
    dest_text text,
    fare_quote_cents integer,
    ride_id uuid,
    selfie_url text,
    driver_id uuid,
    rider_profile_id uuid,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT whatsapp_conversations_state_check CHECK (state IN (
        'TAP_RECEIVED', 'AWAITING_DESTINATION', 'FARE_QUOTED', 'AWAITING_SELFIE',
        'DRIVER_SEARCHING', 'DRIVER_ASSIGNED', 'COMPLETED', 'APP_INVITE_SENT',
        'CANCELLED', 'NO_DRIVERS'
    ))
);

CREATE INDEX IF NOT EXISTS idx_wa_convo_phone
    ON public.whatsapp_conversations (phone_number, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_convo_ride
    ON public.whatsapp_conversations (ride_id) WHERE ride_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_convo_state
    ON public.whatsapp_conversations (state);

-- 2. Inbound idempotency (Meta may redeliver webhooks) ------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_processed_messages (
    message_id text PRIMARY KEY,
    received_at timestamptz DEFAULT now() NOT NULL
);

-- 3. Ride origin ---------------------------------------------------------------
ALTER TABLE public.rides
    ADD COLUMN IF NOT EXISTS origin text DEFAULT 'app' NOT NULL;

-- 4. Selfie bucket (private; only service-role edge functions read/write for now.
--    Driver-app viewing needs signed URLs — follow-up, not wired here.)
INSERT INTO storage.buckets (id, name, public)
VALUES ('ride-selfies', 'ride-selfies', false)
ON CONFLICT (id) DO NOTHING;

-- 5. Webhook base URL (admin-editable via existing admin_set_system_config) ----
INSERT INTO public.system_config (key, value, description)
VALUES ('whatsapp_webhook_base',
        'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/whatsapp_webhook',
        'Base URL of the WhatsApp inbound webhook. The rides trigger POSTs ride-assigned / ride-completed events here via pg_net.')
ON CONFLICT (key) DO NOTHING;

-- 6. Ride-event trigger -> webhook --------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_whatsapp_ride_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_base text;
    v_url text;
    v_event text;
BEGIN
    -- Fire only on a genuine status transition into assigned / completed.
    -- (accept_ride moves searching -> assigned; complete_ride moves -> completed.)
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status::text IN ('assigned', 'completed')
       AND EXISTS (SELECT 1 FROM public.whatsapp_conversations WHERE ride_id = NEW.id)
    THEN
        v_event := CASE WHEN NEW.status::text = 'assigned'
                        THEN 'ride-assigned' ELSE 'ride-completed' END;
        SELECT value INTO v_base FROM public.system_config
        WHERE key = 'whatsapp_webhook_base';
        IF v_base IS NULL OR v_base = '' THEN
            v_base := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/whatsapp_webhook';
        END IF;
        v_url := v_base || '/events/' || v_event;
        -- Fire-and-forget: a failed POST must never block the ride update.
        -- The webhook endpoint re-reads the ride and acts only on true state.
        PERFORM net.http_post(
            url := v_url,
            headers := jsonb_build_object('Content-Type', 'application/json'),
            body := jsonb_build_object('ride_id', NEW.id::text, 'event', v_event)
        );
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Never break the ride write because the notification failed.
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS whatsapp_ride_events_trigger ON public.rides;
CREATE TRIGGER whatsapp_ride_events_trigger
AFTER UPDATE OF status ON public.rides
FOR EACH ROW
EXECUTE FUNCTION public.notify_whatsapp_ride_event();
