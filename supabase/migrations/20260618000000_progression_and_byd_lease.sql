-- ═══════════════════════════════════════════════════════════════════════════
-- G-Taxi Progression + BYD Lease System
-- Migration: 20260618000000_progression_and_byd_lease
--
-- Implements the council-designed ecosystem lock-in:
--   Rider levels 1-5 (rides → grocery → laundry → wallet bonus → G-Escape)
--   Capital reserve flywheel with live reserve_health singleton
--   Driver BYD lease qualification (90 active days) + per-ride installment
--   Contextual home screen suggestion via get_home_suggestion()
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. RIDER PROGRESSION TABLES ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rider_progression (
  rider_id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  level                SMALLINT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 5),
  total_rides          INTEGER  NOT NULL DEFAULT 0,
  total_grocery_orders INTEGER  NOT NULL DEFAULT 0,
  total_laundry_orders INTEGER  NOT NULL DEFAULT 0,
  total_nfc_taps       INTEGER  NOT NULL DEFAULT 0,
  wallet_ever_funded   BOOLEAN  NOT NULL DEFAULT false,
  escape_ever_booked   BOOLEAN  NOT NULL DEFAULT false,
  unlocked_verticals   TEXT[]   NOT NULL DEFAULT '{rides}',
  notified_level       SMALLINT NOT NULL DEFAULT 1,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only activity ledger. Dedup on ride_id prevents double-counting.
CREATE TABLE IF NOT EXISTS public.rider_activity_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL CHECK (event_type IN (
    'ride_completed', 'grocery_order', 'laundry_order',
    'nfc_tap', 'wallet_topup', 'escape_booking'
  )),
  amount_cents INTEGER,
  ride_id      UUID REFERENCES rides(id) ON DELETE SET NULL,
  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rider_activity_rider    ON public.rider_activity_log(rider_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rider_activity_ride
  ON public.rider_activity_log(ride_id) WHERE ride_id IS NOT NULL;

-- Admin-configurable level thresholds. Changing a row here takes effect on
-- the next call to record_rider_activity — no code deploy needed.
CREATE TABLE IF NOT EXISTS public.progression_config (
  level             SMALLINT PRIMARY KEY CHECK (level BETWEEN 2 AND 5),
  unlock_vertical   TEXT NOT NULL,
  threshold_type    TEXT NOT NULL CHECK (threshold_type IN (
    'rides', 'grocery_orders', 'laundry_orders', 'wallet_funded', 'escape_booked'
  )),
  threshold_value   INTEGER NOT NULL,
  push_title        TEXT NOT NULL,
  push_body         TEXT NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.progression_config
  (level, unlock_vertical, threshold_type, threshold_value, push_title, push_body)
VALUES
  (2, 'grocery',       'rides',           5,  'G-Grocery unlocked',          'Order food and groceries delivered right to your door.'),
  (3, 'laundry_nfc',   'grocery_orders',  2,  'G-Laundry and NFC unlocked',  'Drop off laundry on your next ride. Tap any G-Taxi kiosk to pay.'),
  (4, 'gwallet_bonus', 'laundry_orders',  1,  'G-Wallet bonus activated',    'Top up TTD $200, get TTD $220 in ride credits.'),
  (5, 'g_escape',      'wallet_funded',   1,  'You are invited to G-Escape', 'Exclusive Caribbean packages — only for our most loyal riders.')
ON CONFLICT (level) DO NOTHING;

-- ── 2. DRIVER LEASE TABLES ───────────────────────────────────────────────

-- Tracks the 90-active-day qualification window per driver.
CREATE TABLE IF NOT EXISTS public.driver_lease_eligibility (
  driver_id         UUID PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,
  active_days_count INTEGER  NOT NULL DEFAULT 0,
  first_active_date DATE,
  last_active_date  DATE,
  qualified         BOOLEAN  NOT NULL DEFAULT false,
  qualified_at      TIMESTAMPTZ,
  notified          BOOLEAN  NOT NULL DEFAULT false,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dispute log for contested lease deductions.
CREATE TABLE IF NOT EXISTS public.lease_disputes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id     UUID NOT NULL REFERENCES fleet_leases(id) ON DELETE CASCADE,
  driver_id    UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  disputed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'resolved_waived', 'resolved_denied')),
  admin_note   TEXT,
  resolved_at  TIMESTAMPTZ,
  resolved_by  UUID REFERENCES auth.users(id),
  amount_cents INTEGER NOT NULL
);

-- Extend fleet_leases with BYD-specific columns.
ALTER TABLE public.fleet_leases
  ADD COLUMN IF NOT EXISTS per_ride_installment_cents INTEGER,
  ADD COLUMN IF NOT EXISTS dispute_open               BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspension_reason          TEXT,
  ADD COLUMN IF NOT EXISTS reserve_funded             BOOLEAN  NOT NULL DEFAULT false;

-- Unique ride-level dedup on lease_payments (may already exist — safe).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename = 'lease_payments'
      AND indexname = 'idx_lease_payments_ride_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_lease_payments_ride_unique
      ON public.lease_payments(ride_id) WHERE ride_id IS NOT NULL;
  END IF;
END;
$$;

-- ── 3. RESERVE HEALTH SINGLETON ──────────────────────────────────────────

-- One row, enforced by PRIMARY KEY on a BOOLEAN column.
-- Updated atomically inside post_reserve_contribution().
CREATE TABLE IF NOT EXISTS public.reserve_health (
  id                      BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  locked_cents            BIGINT  NOT NULL DEFAULT 0,
  deployed_cents          BIGINT  NOT NULL DEFAULT 0,
  target_deployment_cents BIGINT  NOT NULL DEFAULT 50000000,  -- TTD $500,000
  reserve_health_ratio    NUMERIC(8,4) NOT NULL DEFAULT 0,
  computed_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.reserve_health DEFAULT VALUES ON CONFLICT DO NOTHING;

-- Bootstrap from existing ledger (idempotent).
UPDATE public.reserve_health
SET
  locked_cents         = COALESCE((SELECT SUM(amount_cents) FROM public.capital_reserve_ledger WHERE status = 'locked'),   0),
  deployed_cents       = COALESCE((SELECT SUM(amount_cents) FROM public.capital_reserve_ledger WHERE status = 'deployed'), 0),
  reserve_health_ratio = COALESCE(
    (SELECT SUM(amount_cents)::numeric / 50000000 FROM public.capital_reserve_ledger WHERE status IN ('locked','deployed')),
    0
  ),
  computed_at          = now()
WHERE id = true;

-- ── 4. EXTEND EXISTING TABLES ────────────────────────────────────────────

ALTER TABLE public.capital_reserve_ledger
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'ride'
    CHECK (source_type IN ('ride', 'escape_margin', 'travel_margin', 'grocery', 'laundry'));

-- ── 5. RLS ───────────────────────────────────────────────────────────────

ALTER TABLE public.rider_progression       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rider_activity_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progression_config      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_lease_eligibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lease_disputes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reserve_health          ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'rider_reads_own_progression' AND tablename = 'rider_progression') THEN
    CREATE POLICY rider_reads_own_progression ON public.rider_progression FOR SELECT USING (rider_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'rider_reads_own_activity' AND tablename = 'rider_activity_log') THEN
    CREATE POLICY rider_reads_own_activity ON public.rider_activity_log FOR SELECT USING (rider_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_read_progression_config' AND tablename = 'progression_config') THEN
    CREATE POLICY public_read_progression_config ON public.progression_config FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'driver_reads_own_eligibility' AND tablename = 'driver_lease_eligibility') THEN
    CREATE POLICY driver_reads_own_eligibility ON public.driver_lease_eligibility FOR SELECT
      USING (driver_id IN (SELECT id FROM drivers WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'driver_reads_own_disputes' AND tablename = 'lease_disputes') THEN
    CREATE POLICY driver_reads_own_disputes ON public.lease_disputes FOR SELECT
      USING (driver_id IN (SELECT id FROM drivers WHERE user_id = auth.uid()));
  END IF;
END; $$;

-- ── 6. RPC: record_rider_activity ────────────────────────────────────────
-- Atomic: appends to rider_activity_log, recomputes progression, evaluates level-up.
-- Idempotent on ride_id — safe to retry on network failure.
-- Levels are a ratchet — they never regress.

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
    WHEN 'ride_completed'  THEN v_prog.total_rides          := v_prog.total_rides + 1;
    WHEN 'grocery_order'   THEN v_prog.total_grocery_orders := v_prog.total_grocery_orders + 1;
    WHEN 'laundry_order'   THEN v_prog.total_laundry_orders := v_prog.total_laundry_orders + 1;
    WHEN 'nfc_tap'         THEN v_prog.total_nfc_taps       := v_prog.total_nfc_taps + 1;
    WHEN 'wallet_topup'    THEN v_prog.wallet_ever_funded   := true;
    WHEN 'escape_booking'  THEN v_prog.escape_ever_booked   := true;
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
      EXIT; -- Only unlock one level per call — next call will check again
    ELSE
      EXIT; -- Sequential: stop at first failed threshold
    END IF;
  END LOOP;

  -- Persist
  UPDATE public.rider_progression SET
    level                = v_prog.level,
    total_rides          = v_prog.total_rides,
    total_grocery_orders = v_prog.total_grocery_orders,
    total_laundry_orders = v_prog.total_laundry_orders,
    total_nfc_taps       = v_prog.total_nfc_taps,
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

-- ── 7. RPC: post_reserve_contribution ───────────────────────────────────
-- Replaces direct INSERT into capital_reserve_ledger.
-- Atomically updates the reserve_health singleton.

CREATE OR REPLACE FUNCTION public.post_reserve_contribution(
  p_source_id    UUID,
  p_amount_cents INTEGER,
  p_source_type  TEXT DEFAULT 'ride'
) RETURNS TABLE (
  ledger_id           UUID,
  new_locked_cents    BIGINT,
  new_health_ratio    NUMERIC,
  deployment_now_safe BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id     UUID;
  v_locked BIGINT;
  v_target BIGINT;
  v_ratio  NUMERIC;
BEGIN
  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'reserve contribution must be positive, got %', p_amount_cents;
  END IF;

  INSERT INTO public.capital_reserve_ledger (ride_id, amount_cents, status, source_type, notes)
  VALUES (p_source_id, p_amount_cents, 'locked', p_source_type, 'auto:' || p_source_type)
  RETURNING id INTO v_id;

  UPDATE public.reserve_health SET
    locked_cents         = locked_cents + p_amount_cents,
    reserve_health_ratio = (locked_cents + p_amount_cents)::numeric / target_deployment_cents,
    computed_at          = now()
  WHERE id = true
  RETURNING locked_cents, target_deployment_cents,
            reserve_health_ratio
  INTO v_locked, v_target, v_ratio;

  RETURN QUERY SELECT v_id, v_locked, v_ratio, (v_ratio >= 1.0);
END;
$$;

-- ── 8. RPC: deduct_lease_installment_for_ride ───────────────────────────
-- Per-ride BYD lease deduction. Idempotent on ride_id.
-- Called inside complete_ride BEFORE driver wallet is credited.

CREATE OR REPLACE FUNCTION public.deduct_lease_installment_for_ride(
  p_lease_id    UUID,
  p_ride_id     UUID,
  p_gross_cents INTEGER
) RETURNS TABLE (
  gross_cents       INTEGER,
  installment_cents INTEGER,
  net_to_driver     INTEGER,
  success           BOOLEAN,
  error_message     TEXT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_lease       RECORD;
  v_installment INTEGER;
  v_existing    INTEGER;
BEGIN
  -- Idempotency: return existing payment if ride already settled
  SELECT amount_cents INTO v_existing FROM public.lease_payments
  WHERE ride_id = p_ride_id LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT p_gross_cents, v_existing, p_gross_cents - v_existing, true, NULL::text;
    RETURN;
  END IF;

  -- Fetch and lock active lease
  SELECT * INTO v_lease FROM public.fleet_leases
  WHERE id = p_lease_id AND status = 'active' AND NOT COALESCE(dispute_open, false)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT p_gross_cents, 0, p_gross_cents, false,
      'Lease not active or has open dispute'::text;
    RETURN;
  END IF;

  -- Installment = min(configured per-ride amount, 15% of gross)
  -- The 15% cap ensures small rides don't result in zero driver payout
  v_installment := LEAST(
    COALESCE(v_lease.per_ride_installment_cents, 5000),
    ROUND(p_gross_cents * 0.15)
  );

  IF v_installment <= 0 OR p_gross_cents - v_installment < 0 THEN
    RETURN QUERY SELECT p_gross_cents, 0, p_gross_cents, false,
      'Ride fare too small for installment deduction'::text;
    RETURN;
  END IF;

  -- Record the payment
  INSERT INTO public.lease_payments (lease_id, ride_id, amount_cents, status)
  VALUES (p_lease_id, p_ride_id, v_installment, 'paid')
  ON CONFLICT DO NOTHING;

  RETURN QUERY SELECT p_gross_cents, v_installment, p_gross_cents - v_installment, true, NULL::text;
END;
$$;

-- ── 9. RPC: refresh_driver_lease_eligibility ─────────────────────────────
-- Counts distinct active days in last 180 days. Qualifies at 90.
-- Called daily by cron and on-demand after ride completion.

CREATE OR REPLACE FUNCTION public.refresh_driver_lease_eligibility(
  p_driver_id UUID
) RETURNS TABLE (
  active_days_count INTEGER,
  qualified         BOOLEAN,
  newly_qualified   BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_days          INTEGER;
  v_first         DATE;
  v_last          DATE;
  v_was_qualified BOOLEAN := false;
  v_now_qualified BOOLEAN;
BEGIN
  SELECT
    COUNT(DISTINCT DATE(r.completed_at))::integer,
    MIN(DATE(r.completed_at)),
    MAX(DATE(r.completed_at))
  INTO v_days, v_first, v_last
  FROM public.rides r
  WHERE r.driver_id = p_driver_id
    AND r.status = 'completed'
    AND r.completed_at >= now() - INTERVAL '180 days';

  v_days          := COALESCE(v_days, 0);
  v_now_qualified := v_days >= 90;

  SELECT qualified INTO v_was_qualified
  FROM public.driver_lease_eligibility WHERE driver_id = p_driver_id;

  INSERT INTO public.driver_lease_eligibility
    (driver_id, active_days_count, first_active_date, last_active_date, qualified, qualified_at, updated_at)
  VALUES
    (p_driver_id, v_days, v_first, v_last, v_now_qualified,
     CASE WHEN v_now_qualified AND NOT COALESCE(v_was_qualified, false) THEN now() ELSE NULL END,
     now())
  ON CONFLICT (driver_id) DO UPDATE SET
    active_days_count = v_days,
    first_active_date = COALESCE(v_first, driver_lease_eligibility.first_active_date),
    last_active_date  = v_last,
    qualified         = v_now_qualified,
    qualified_at      = CASE
      WHEN v_now_qualified AND NOT driver_lease_eligibility.qualified
      THEN now() ELSE driver_lease_eligibility.qualified_at END,
    updated_at        = now();

  RETURN QUERY SELECT v_days, v_now_qualified,
    (v_now_qualified AND NOT COALESCE(v_was_qualified, false));
END;
$$;

-- ── 10. RPC: get_home_suggestion ─────────────────────────────────────────
-- Contextual home screen suggestion. NEVER raises — always returns a row.
-- Priority: new_unlock > time_of_day > next_unlock_carrot > default

CREATE OR REPLACE FUNCTION public.get_home_suggestion(
  p_rider_id    UUID,
  p_hour_of_day SMALLINT DEFAULT NULL
) RETURNS TABLE (
  vertical      TEXT,
  cta_text      TEXT,
  cta_deep_link TEXT,
  reason_code   TEXT,
  confidence    NUMERIC
) LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_prog public.rider_progression%ROWTYPE;
  v_hour SMALLINT;
  v_cfg  RECORD;
BEGIN
  v_hour := COALESCE(p_hour_of_day, EXTRACT(HOUR FROM now())::smallint);

  SELECT * INTO v_prog FROM public.rider_progression WHERE rider_id = p_rider_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'rides'::text, 'Where to?'::text, 'gtaxi://ride'::text, 'default'::text, 0.5::numeric;
    RETURN;
  END IF;

  -- Priority 1: level just changed, notified_level is behind — surface the new vertical
  IF v_prog.level > v_prog.notified_level THEN
    SELECT * INTO v_cfg FROM public.progression_config WHERE level = v_prog.level;
    IF FOUND THEN
      UPDATE public.rider_progression SET notified_level = v_prog.level WHERE rider_id = p_rider_id;
      RETURN QUERY SELECT
        v_cfg.unlock_vertical,
        v_cfg.push_body,
        ('gtaxi://' || v_cfg.unlock_vertical)::text,
        'new_unlock'::text,
        0.95::numeric;
      RETURN;
    END IF;
  END IF;

  -- Priority 2: time-of-day signals (only for unlocked verticals)
  IF v_hour BETWEEN 11 AND 14 AND 'grocery' = ANY(v_prog.unlocked_verticals) THEN
    RETURN QUERY SELECT 'grocery'::text, 'Lunch delivered in 30 min'::text,
      'gtaxi://grocery'::text, 'time_of_day'::text, 0.80::numeric;
    RETURN;
  END IF;

  IF v_hour BETWEEN 17 AND 20 AND 'grocery' = ANY(v_prog.unlocked_verticals) THEN
    RETURN QUERY SELECT 'grocery'::text, 'Dinner sorted — order now'::text,
      'gtaxi://grocery'::text, 'time_of_day'::text, 0.85::numeric;
    RETURN;
  END IF;

  IF v_hour BETWEEN 7 AND 9 AND v_prog.total_rides > 0 THEN
    RETURN QUERY SELECT 'rides'::text, 'Morning commute — book now'::text,
      'gtaxi://ride'::text, 'time_of_day'::text, 0.72::numeric;
    RETURN;
  END IF;

  -- Priority 3: show the next carrot (what they need to unlock the next level)
  SELECT * INTO v_cfg FROM public.progression_config
  WHERE level > v_prog.level ORDER BY level ASC LIMIT 1;

  IF FOUND THEN
    DECLARE
      v_current  INTEGER := 0;
      v_required INTEGER := v_cfg.threshold_value;
      v_remain   INTEGER;
    BEGIN
      IF    v_cfg.threshold_type = 'rides'          THEN v_current := v_prog.total_rides;
      ELSIF v_cfg.threshold_type = 'grocery_orders' THEN v_current := v_prog.total_grocery_orders;
      ELSIF v_cfg.threshold_type = 'laundry_orders' THEN v_current := v_prog.total_laundry_orders;
      END IF;
      v_remain := GREATEST(0, v_required - v_current);
      IF v_remain > 0 THEN
        RETURN QUERY SELECT
          'rides'::text,
          ('Book ' || v_remain || ' more ride' || CASE WHEN v_remain > 1 THEN 's' ELSE '' END || ' to unlock ' || v_cfg.unlock_vertical)::text,
          'gtaxi://ride'::text,
          'next_unlock'::text,
          0.60::numeric;
        RETURN;
      END IF;
    END;
  END IF;

  -- Default
  RETURN QUERY SELECT 'rides'::text, 'Where to?'::text, 'gtaxi://ride'::text, 'default'::text, 0.40::numeric;

EXCEPTION WHEN OTHERS THEN
  -- Never raise to caller — always return a safe default
  RETURN QUERY SELECT 'rides'::text, 'Where to?'::text, 'gtaxi://ride'::text, 'default'::text, 0.10::numeric;
END;
$$;

-- ── 11. pg_cron: daily driver eligibility refresh ────────────────────────

SELECT cron.schedule(
  'refresh-driver-lease-eligibility',
  '0 6 * * *',
  $$
  SELECT public.refresh_driver_lease_eligibility(d.id)
  FROM public.drivers d
  WHERE d.status = 'active'
  $$
) ON CONFLICT DO NOTHING;
