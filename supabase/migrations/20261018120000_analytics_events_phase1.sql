-- ═══════════════════════════════════════════════════════════════════
-- Phase 1 analytics: event LOGGING only (no predictions, no nudges).
-- Proposal 2026-10-18, NOT APPLIED.
--
-- What a row is: who (user_id), which app, what happened (event), when
-- (created_at), and the ride or order it was about. Nothing else.
--
-- What is deliberately NOT stored, and cannot be added without changing
-- this table: no location or GPS, no device id or fingerprint, no IP,
-- no Wi-Fi, no ringer mode, no battery, no free-text, no metadata/jsonb
-- column. Event names and cancel reasons are fixed lists (CHECK), so the
-- table cannot quietly grow into tracking.
--
-- Where events come from:
--   * Most are written by the database at the moment the real thing
--     happens (triggers below). They are accurate, cannot be faked, and
--     work on app builds already on people's phones.
--   * Three happen only on the phone (app opened, destination searched,
--     referral shared). The apps call log_app_event(), which takes the
--     user from the sign-in (never from the request) and is rate-limited.
--   * Two are written by server functions that know who acted: the rider
--     cancel (cancel_ride, with the reason) and the merchant accept/reject
--     (merchant update_order_status), via log_analytics_event_internal().
--
-- A logging failure must never block a ride, payout or order: every
-- write is wrapped so it can only fail silently.
--
-- Access: nobody can read another person's events. Admins can read for
-- analysis. Users cannot write rows directly. Rows are kept 13 months,
-- then deleted automatically; deleting an account deletes its events.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app         text NOT NULL CHECK (app IN ('rider', 'driver', 'merchant')),
  event       text NOT NULL CHECK (event IN (
                -- rider
                'rider_app_opened', 'rider_destination_searched', 'rider_ride_booked',
                'rider_ride_cancelled', 'rider_ride_completed', 'rider_referral_shared',
                -- driver
                'driver_went_online', 'driver_went_offline', 'driver_offer_received',
                'driver_offer_accepted', 'driver_offer_declined', 'driver_ride_completed',
                'driver_payout_requested',
                -- merchant
                'merchant_order_received', 'merchant_order_accepted', 'merchant_order_rejected',
                -- PROPOSED EXTRAS (not in the brief; strike if unwanted):
                'driver_offer_expired',   -- offer timed out with no answer
                'driver_timed_out'        -- switched offline automatically after 15 min silent
              )),
  ride_id     uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  order_id    uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  cancel_reason text CHECK (cancel_reason IS NULL OR cancel_reason IN (
                'driver_too_far', 'waited_too_long', 'driver_asked_me_to_cancel',
                'booked_by_mistake', 'changed_plans', 'price_too_high',
                'found_another_ride', 'felt_unsafe', 'other', 'not_given')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (cancel_reason IS NULL OR event = 'rider_ride_cancelled')
);

CREATE INDEX IF NOT EXISTS analytics_events_user_time ON public.analytics_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_event_time ON public.analytics_events (event, created_at DESC);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_events FROM anon, authenticated;
GRANT SELECT ON public.analytics_events TO authenticated;
DROP POLICY IF EXISTS "Admins read analytics events" ON public.analytics_events;
CREATE POLICY "Admins read analytics events" ON public.analytics_events
  FOR SELECT TO authenticated USING (public.auth_is_admin());

-- ── The one internal writer (server side only) ───────────────────────
CREATE OR REPLACE FUNCTION public.log_analytics_event_internal(
  p_user_id uuid, p_app text, p_event text,
  p_ride_id uuid DEFAULT NULL, p_order_id uuid DEFAULT NULL, p_cancel_reason text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.analytics_events (user_id, app, event, ride_id, order_id, cancel_reason)
  VALUES (p_user_id, p_app, p_event, p_ride_id, p_order_id, p_cancel_reason);
EXCEPTION WHEN OTHERS THEN
  NULL;   -- analytics must never break the action it describes
END;
$function$;
REVOKE ALL ON FUNCTION public.log_analytics_event_internal(uuid, text, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- ── Phone-only events (rider app) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_app_event(p_event text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF p_event NOT IN ('rider_app_opened', 'rider_destination_searched', 'rider_referral_shared') THEN
    RETURN;   -- every other event is recorded by the server, not the phone
  END IF;
  IF NOT public.check_rate_limit(auth.uid(), 'log_app_event', 60, 60) THEN
    RETURN;
  END IF;
  PERFORM public.log_analytics_event_internal(auth.uid(), 'rider', p_event);
END;
$function$;
REVOKE ALL ON FUNCTION public.log_app_event(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_app_event(text) TO authenticated;

-- ── Rides: booked, completed (rider and driver) ──────────────────────
CREATE OR REPLACE FUNCTION public.analytics_on_ride()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_analytics_event_internal(NEW.rider_id, 'rider', 'rider_ride_booked', NEW.id);
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text = 'completed' THEN
    PERFORM public.log_analytics_event_internal(NEW.rider_id, 'rider', 'rider_ride_completed', NEW.id);
    PERFORM public.log_analytics_event_internal(
      (SELECT user_id FROM public.drivers WHERE id = NEW.driver_id), 'driver', 'driver_ride_completed', NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_analytics_on_ride ON public.rides;
CREATE TRIGGER trg_analytics_on_ride
  AFTER INSERT OR UPDATE OF status ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.analytics_on_ride();

-- ── Drivers: online / offline (and automatic time-out) ───────────────
CREATE OR REPLACE FUNCTION public.analytics_on_driver_online()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.is_online IS DISTINCT FROM OLD.is_online THEN
    PERFORM public.log_analytics_event_internal(NEW.user_id, 'driver',
      CASE
        WHEN NEW.is_online THEN 'driver_went_online'
        WHEN coalesce(current_setting('gtaxi.offline_cause', true), '') = 'stale' THEN 'driver_timed_out'
        ELSE 'driver_went_offline'
      END);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_analytics_on_driver_online ON public.drivers;
CREATE TRIGGER trg_analytics_on_driver_online
  AFTER UPDATE OF is_online ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.analytics_on_driver_online();

-- The 15-minute sweep marks its own offline switches so they are logged as
-- driver_timed_out, not as the driver choosing to stop. Same function as
-- live, plus the one set_config line.
CREATE OR REPLACE FUNCTION public.sweep_stale_online_drivers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  n integer;
BEGIN
  PERFORM set_config('gtaxi.offline_cause', 'stale', true);
  UPDATE public.drivers
     SET is_online = false, status = 'offline'
   WHERE is_online = true
     AND active_ride_id IS NULL
     AND COALESCE(GREATEST(last_seen, last_location_update), 'epoch'::timestamptz) < now() - interval '15 minutes';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('gtaxi.offline_cause', '', true);
  RETURN n;
END;
$function$;
REVOKE ALL ON FUNCTION public.sweep_stale_online_drivers() FROM PUBLIC, anon, authenticated;

-- ── Offers: received / accepted / declined / expired ─────────────────
CREATE OR REPLACE FUNCTION public.analytics_on_offer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_driver_user uuid;
  v_ride uuid;
  v_order uuid;
BEGIN
  SELECT user_id INTO v_driver_user FROM public.drivers WHERE id = NEW.driver_id;
  IF TG_TABLE_NAME = 'ride_offers' THEN v_ride := NEW.ride_id; ELSE v_order := NEW.order_id; END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_analytics_event_internal(v_driver_user, 'driver', 'driver_offer_received', v_ride, v_order);
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('accepted', 'declined', 'expired') THEN
    PERFORM public.log_analytics_event_internal(v_driver_user, 'driver', 'driver_offer_' || NEW.status, v_ride, v_order);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_analytics_on_ride_offer ON public.ride_offers;
CREATE TRIGGER trg_analytics_on_ride_offer
  AFTER INSERT OR UPDATE OF status ON public.ride_offers
  FOR EACH ROW EXECUTE FUNCTION public.analytics_on_offer();
DROP TRIGGER IF EXISTS trg_analytics_on_delivery_offer ON public.delivery_offers;
CREATE TRIGGER trg_analytics_on_delivery_offer
  AFTER INSERT OR UPDATE OF status ON public.delivery_offers
  FOR EACH ROW EXECUTE FUNCTION public.analytics_on_offer();

-- ── Payout requested (drivers only, not commander payouts) ───────────
CREATE OR REPLACE FUNCTION public.analytics_on_payout_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.driver_id IS NOT NULL THEN
    PERFORM public.log_analytics_event_internal(
      COALESCE((SELECT user_id FROM public.drivers WHERE id = NEW.driver_id), NEW.driver_id),
      'driver', 'driver_payout_requested');
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_analytics_on_payout_request ON public.payout_requests;
CREATE TRIGGER trg_analytics_on_payout_request
  AFTER INSERT ON public.payout_requests
  FOR EACH ROW EXECUTE FUNCTION public.analytics_on_payout_request();

-- ── Merchant received an order (logged for the shop's owner login) ───
CREATE OR REPLACE FUNCTION public.analytics_on_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.merchant_id IS NOT NULL THEN
    PERFORM public.log_analytics_event_internal(
      (SELECT created_by FROM public.merchants WHERE id = NEW.merchant_id),
      'merchant', 'merchant_order_received', NULL, NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_analytics_on_order ON public.orders;
CREATE TRIGGER trg_analytics_on_order
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.analytics_on_order();

REVOKE ALL ON FUNCTION public.analytics_on_ride() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_on_driver_online() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_on_offer() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_on_payout_request() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_on_order() FROM PUBLIC, anon, authenticated;

-- ── Keep 13 months, then delete ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_old_analytics_events()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE n integer;
BEGIN
  DELETE FROM public.analytics_events WHERE created_at < now() - interval '13 months';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;
REVOKE ALL ON FUNCTION public.purge_old_analytics_events() FROM PUBLIC, anon, authenticated;

DO $cron$
BEGIN
  PERFORM cron.unschedule('purge-old-analytics-events')
   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-old-analytics-events');
  PERFORM cron.schedule('purge-old-analytics-events', '17 4 * * *', 'SELECT public.purge_old_analytics_events()');
END
$cron$;
