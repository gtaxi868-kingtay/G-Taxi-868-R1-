-- Carnival/Fete Vertical — ecosystem integration
-- Ties carnival into: vertical_settings (admin toggle),
-- notifications (push on band join), progression XP,
-- and ride destination (Ride to venue).
--
-- ── DESIGN ──────────────────────────────────────────────────────────────────
-- Carnival is seasonal (Jan–Apr). When enabled by admin, ALL riders see the
-- Carnival vertical card — no level gate needed. But riders earn progression
-- XP for booking fetes (carnival_booking event), feeding the same level 1–5
-- system that unlocks grocery, laundry, g-escape.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. VERTICAL SETTINGS --------------------------------------------------------
-- Admin toggles carnival on/off via MerchantNetwork panel, same as other
-- verticals. Starts disabled — admin must explicitly enable.
INSERT INTO public.vertical_settings (vertical_name, display_name, is_enabled, enabled_regions,
    requires_subscription, commission_rate_percent, icon_name, sort_order, config)
VALUES (
    'carnival',
    'Carnival',
    false,
    '{}',
    false,
    12,
    'musical-notes',
    7,
    '{"tagline": "Bands, fetes & the greatest show on earth", "revshare_pct": 5, "driver_split_pct": 81}'
)
ON CONFLICT (vertical_name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    commission_rate_percent = EXCLUDED.commission_rate_percent,
    icon_name = EXCLUDED.icon_name,
    sort_order = EXCLUDED.sort_order,
    config = EXCLUDED.config,
    updated_at = now();

-- Enable the feature flag so app shows the carnival card
UPDATE public.system_feature_flags
SET is_active = true
WHERE id = 'carnival_active';

-- 2. NOTIFICATION TYPE --------------------------------------------------------
-- Add 'carnival' to the allowed notification types so triggers can emit
-- carnival-specific push notifications.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN ('ride','payment','promo','escape','grocery','laundry','carnival','system'));

-- 3. CARNIVAL NOTIFICATION TRIGGER --------------------------------------------
-- Fires when a rider joins a band: emits an in-app notification so the rider
-- knows their band membership is active and revshare tracking has started.
CREATE OR REPLACE FUNCTION public.emit_carnival_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_band_name TEXT;
BEGIN
    SELECT name INTO v_band_name FROM public.carnival_bands WHERE id = NEW.band_id;

    PERFORM public.notify_user(NEW.rider_id, 'carnival',
        'Welcome to ' || COALESCE(v_band_name, 'the band') || '!',
        'Your band membership is active. Tap band keychains at fetes to earn revshare on your rides.');

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_emit_carnival_notification ON public.band_members;
CREATE TRIGGER trg_emit_carnival_notification
    AFTER INSERT ON public.band_members
    FOR EACH ROW
    EXECUTE FUNCTION public.emit_carnival_notification();

-- 4. PROGRESSION XP -----------------------------------------------------------
-- Add 'carnival_booking' to the allowed event types so riders earn XP
-- toward their level when they book a fete or band package.
ALTER TABLE public.rider_activity_log DROP CONSTRAINT IF EXISTS rider_activity_log_event_type_check;

ALTER TABLE public.rider_activity_log ADD CONSTRAINT rider_activity_log_event_type_check
    CHECK (event_type IN (
        'ride_completed', 'grocery_order', 'laundry_order',
        'nfc_tap', 'wallet_topup', 'escape_booking',
        'carnival_booking'
    ));

-- Add counter column to rider_progression for analytics
ALTER TABLE public.rider_progression
    ADD COLUMN IF NOT EXISTS total_carnival_bookings INTEGER NOT NULL DEFAULT 0;

-- Recreate the record_rider_activity RPC with carnival_booking handler
CREATE OR REPLACE FUNCTION public.record_rider_activity(
  p_rider_id     UUID,
  p_event_type   TEXT,
  p_amount_cents INTEGER DEFAULT NULL,
  p_ride_id      UUID    DEFAULT NULL,
  p_metadata     JSONB   DEFAULT '{}'
) RETURNS TABLE (
  level_before  SMALLINT,
  level_after   SMALLINT,
  leveled_up    BOOLEAN,
  new_unlock    TEXT,
  total_rides   INTEGER,
  total_grocery INTEGER,
  total_laundry INTEGER
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_prog        public.rider_progression%ROWTYPE;
  v_level_before SMALLINT;
  v_new_unlock   TEXT := NULL;
  v_cfg          RECORD;
  passes         BOOLEAN;
BEGIN
  -- Ensure row exists
  INSERT INTO public.rider_progression (rider_id)
  VALUES (p_rider_id) ON CONFLICT (rider_id) DO NOTHING;

  -- Lock for update
  SELECT * INTO v_prog FROM public.rider_progression WHERE rider_id = p_rider_id FOR UPDATE;
  v_level_before := v_prog.level;

  -- Idempotency guard on ride_id
  IF p_ride_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.rider_activity_log WHERE ride_id = p_ride_id
  ) THEN
    RETURN QUERY SELECT v_prog.level, v_prog.level, false, NULL::text,
      v_prog.total_rides, v_prog.total_grocery_orders, v_prog.total_laundry_orders;
    RETURN;
  END IF;

  -- Append to activity log
  INSERT INTO public.rider_activity_log (rider_id, event_type, amount_cents, ride_id, metadata)
  VALUES (p_rider_id, p_event_type, p_amount_cents, p_ride_id, COALESCE(p_metadata, '{}'));

  -- Increment counters
  CASE p_event_type
    WHEN 'ride_completed'     THEN v_prog.total_rides             := v_prog.total_rides + 1;
    WHEN 'grocery_order'      THEN v_prog.total_grocery_orders    := v_prog.total_grocery_orders + 1;
    WHEN 'laundry_order'      THEN v_prog.total_laundry_orders    := v_prog.total_laundry_orders + 1;
    WHEN 'nfc_tap'            THEN v_prog.total_nfc_taps          := v_prog.total_nfc_taps + 1;
    WHEN 'wallet_topup'       THEN v_prog.wallet_ever_funded      := true;
    WHEN 'escape_booking'     THEN v_prog.escape_ever_booked      := true;
    WHEN 'carnival_booking'   THEN v_prog.total_carnival_bookings := v_prog.total_carnival_bookings + 1;
    ELSE NULL;
  END CASE;

  -- Evaluate sequential level-ups (stop at first threshold not met)
  FOR v_cfg IN
    SELECT * FROM public.progression_config WHERE level > v_prog.level ORDER BY level ASC
  LOOP
    passes := false;
    IF    v_cfg.threshold_type = 'rides'          AND v_prog.total_rides          >= v_cfg.threshold_value THEN passes := true;
    ELSIF v_cfg.threshold_type = 'grocery_orders' AND v_prog.total_grocery_orders >= v_cfg.threshold_value THEN passes := true;
    ELSIF v_cfg.threshold_type = 'laundry_orders' AND v_prog.total_laundry_orders >= v_cfg.threshold_value THEN passes := true;
    ELSIF v_cfg.threshold_type = 'wallet_funded'  AND v_prog.wallet_ever_funded                             THEN passes := true;
    ELSIF v_cfg.threshold_type = 'escape_booked'  AND v_prog.escape_ever_booked                             THEN passes := true;
    END IF;

    IF passes THEN
      v_prog.level := v_cfg.level;
      v_new_unlock := v_cfg.unlock_vertical;
      v_prog.unlocked_verticals := array_append(v_prog.unlocked_verticals, v_cfg.unlock_vertical);
      EXIT;
    ELSE
      EXIT;
    END IF;
  END LOOP;

  -- Persist
  UPDATE public.rider_progression SET
    level                = v_prog.level,
    total_rides          = v_prog.total_rides,
    total_grocery_orders = v_prog.total_grocery_orders,
    total_laundry_orders = v_prog.total_laundry_orders,
    total_nfc_taps       = v_prog.total_nfc_taps,
    total_carnival_bookings = v_prog.total_carnival_bookings,
    wallet_ever_funded   = v_prog.wallet_ever_funded,
    escape_ever_booked   = v_prog.escape_ever_booked,
    unlocked_verticals   = v_prog.unlocked_verticals,
    updated_at           = now()
  WHERE rider_id = p_rider_id;

  RETURN QUERY SELECT
    v_level_before,
    v_prog.level,
    (v_prog.level > v_level_before),
    v_new_unlock,
    v_prog.total_rides,
    v_prog.total_grocery_orders,
    v_prog.total_laundry_orders;
END;
$$;
