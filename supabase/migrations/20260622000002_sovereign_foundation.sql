-- ════════════════════════════════════════════════════════════════════════
-- SOVEREIGN SUPER-APP FOUNDATION — close every ghost-table / missing-RPC gap
-- ════════════════════════════════════════════════════════════════════════
-- The advanced edge functions (split-pay, event queue, settlement grace,
-- pickup lock, 17% ecosystem pool) were deployed against structures that were
-- never created. This migration builds them EXACTLY as those functions expect:
--
--   TABLES   split_sessions, split_participants, active_zones, seeded_zones,
--            ecosystem_pool_ledger, event_queue, wallets (+ balance sync)
--   RPCs     is_verified_location (FAILS CLOSED), is_coordinate_inside_active_zones,
--            seed_zone, record_pool_entry (17% waterfall), process_settlement_grace
--   CRON     process_event_queue (60s), process_settlement_grace (5min)
--
-- PostGIS is already enabled (20260212). pg_cron guarded as in 20260618.
-- ════════════════════════════════════════════════════════════════════════

-- ── 0. WALLETS (balance cache, kept in sync with the wallet_transactions ledger)
-- confirm_split_payment + process_cash_delivery_settlement read/write this.
CREATE TABLE IF NOT EXISTS public.wallets (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_cents bigint NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Keep wallets.balance_cents authoritative by mirroring every ledger movement.
CREATE OR REPLACE FUNCTION public.sync_wallet_balance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.wallets (user_id, balance_cents, updated_at)
  VALUES (NEW.user_id, COALESCE(NEW.amount, 0), now())
  ON CONFLICT (user_id)
  DO UPDATE SET balance_cents = public.wallets.balance_cents + COALESCE(NEW.amount, 0),
               updated_at = now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_wallet_balance ON public.wallet_transactions;
CREATE TRIGGER trg_sync_wallet_balance
  AFTER INSERT ON public.wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.sync_wallet_balance();

-- Backfill current balances from the ledger (idempotent).
INSERT INTO public.wallets (user_id, balance_cents, updated_at)
SELECT user_id, COALESCE(SUM(amount), 0), now()
FROM public.wallet_transactions
GROUP BY user_id
ON CONFLICT (user_id) DO UPDATE SET balance_cents = EXCLUDED.balance_cents, updated_at = now();

-- ── 1. SPLIT-PAYMENT ENGINE ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.split_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ride_id           uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  total_cents       integer NOT NULL CHECK (total_cents > 0),
  participant_count integer NOT NULL CHECK (participant_count BETWEEN 2 AND 20),
  share_cents       integer NOT NULL CHECK (share_cents >= 0),
  title             text NOT NULL DEFAULT 'Group Ride',
  status            text NOT NULL DEFAULT 'collecting'
                      CHECK (status IN ('collecting','confirmed','partial','expired','cancelled')),
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_split_sessions_status ON public.split_sessions (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_split_sessions_creator ON public.split_sessions (creator_id);

CREATE TABLE IF NOT EXISTS public.split_participants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES public.split_sessions(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  status       text NOT NULL DEFAULT 'confirmed'
                 CHECK (status IN ('confirmed','charged','failed','refunded')),
  charged_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_split_participants_session ON public.split_participants (session_id);

-- ── 2. GEOGRAPHIC ZONES (PostGIS) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.active_zones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  territory_id uuid REFERENCES public.territories(id) ON DELETE SET NULL,
  boundary     geography(Polygon, 4326) NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_active_zones_boundary ON public.active_zones USING GIST (boundary);

CREATE TABLE IF NOT EXISTS public.seeded_zones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lat            double precision NOT NULL,
  lng            double precision NOT NULL,
  location       geography(Point, 4326),
  territory_name text,
  seed_count     integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_seeded_zones_location ON public.seeded_zones USING GIST (location);

-- Seed the launch territory: Sangre Grande operational polygon (~10km box).
INSERT INTO public.active_zones (name, boundary, is_active)
SELECT 'Sangre Grande',
       ST_GeographyFromText('POLYGON((-61.18 10.52, -61.07 10.52, -61.07 10.65, -61.18 10.65, -61.18 10.52))'),
       true
WHERE NOT EXISTS (SELECT 1 FROM public.active_zones WHERE name = 'Sangre Grande');

-- ── 3. ECOSYSTEM POOL LEDGER (17% waterfall: 7 platform / 4 commander / 3 merchant / 3 referral)
CREATE TABLE IF NOT EXISTS public.ecosystem_pool_ledger (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id          uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  beneficiary_type text NOT NULL CHECK (beneficiary_type IN ('platform','commander','merchant','referral')),
  beneficiary_id   uuid,
  pct              numeric(5,2) NOT NULL,
  gross_cents      bigint NOT NULL,
  amount_cents     bigint NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','settled','void')),
  settle_at        timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  settled_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pool_ledger_ride ON public.ecosystem_pool_ledger (ride_id);
CREATE INDEX IF NOT EXISTS idx_pool_ledger_settle ON public.ecosystem_pool_ledger (status, settle_at);
CREATE INDEX IF NOT EXISTS idx_pool_ledger_beneficiary ON public.ecosystem_pool_ledger (beneficiary_type, beneficiary_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pool_ledger_ride_type ON public.ecosystem_pool_ledger (ride_id, beneficiary_type);

-- ── 4. EVENT QUEUE (async cog dispatcher) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type    text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','completed','failed')),
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0,
  max_retries   integer NOT NULL DEFAULT 3,
  last_error    text,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_queue_pending ON public.event_queue (scheduled_for)
  WHERE status = 'pending';

-- ════════════════════════════════════════════════════════════════════════
-- RPCs
-- ════════════════════════════════════════════════════════════════════════

-- 5a. Core point-in-active-zone test (geography-native). Used by the seeding cog.
CREATE OR REPLACE FUNCTION public.is_coordinate_inside_active_zones(p_lat double precision, p_lng double precision)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.active_zones z
    WHERE z.is_active = true
      AND ST_Covers(z.boundary, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography)
  );
END; $$;

-- 5b. Pickup gate — FAILS CLOSED. Any null / no-zone / error path returns false
--     so create_ride + estimate_fare BLOCK unverified pickups (territory lock).
CREATE OR REPLACE FUNCTION public.is_verified_location(p_lat double precision, p_lng double precision)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN COALESCE(public.is_coordinate_inside_active_zones(p_lat, p_lng), false);
EXCEPTION WHEN OTHERS THEN
  -- Fail CLOSED: on any spatial error, treat the pickup as unverified.
  RETURN false;
END; $$;

-- 5c. Seed demand outside active zones (clusters within ~500m).
CREATE OR REPLACE FUNCTION public.seed_zone(p_lat double precision, p_lng double precision, p_territory_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pt geography := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;
  v_id uuid;
BEGIN
  SELECT id INTO v_id
  FROM public.seeded_zones
  WHERE ST_DWithin(location, v_pt, 500)
  ORDER BY ST_Distance(location, v_pt)
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.seeded_zones
       SET seed_count = seed_count + 1, updated_at = now()
     WHERE id = v_id;
  ELSE
    INSERT INTO public.seeded_zones (lat, lng, location, territory_name)
    VALUES (p_lat, p_lng, v_pt, p_territory_name);
  END IF;
END; $$;

-- 5d. 17% ecosystem waterfall. Idempotent per ride (uq_pool_ledger_ride_type).
--     Platform 7% always; commander 4% if territory has an active G-Lead;
--     merchant 3% + referral 3% recorded structurally (beneficiary resolved
--     where data exists, else held by the house until reconciled).
CREATE OR REPLACE FUNCTION public.record_pool_entry(
  p_ride_id        uuid,
  p_gross_cents    bigint,
  p_platform_cents bigint DEFAULT 0,
  p_reserve_cents  bigint DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_territory_id uuid;
  v_driver_id    uuid;
  v_commander_id uuid;
  v_merchant_id  uuid;
  v_referrer_id  uuid;
BEGIN
  IF p_ride_id IS NULL OR COALESCE(p_gross_cents, 0) <= 0 THEN
    RETURN;
  END IF;

  -- Already recorded for this ride? (idempotent)
  IF EXISTS (SELECT 1 FROM public.ecosystem_pool_ledger WHERE ride_id = p_ride_id) THEN
    RETURN;
  END IF;

  SELECT territory_id, driver_id INTO v_territory_id, v_driver_id
  FROM public.rides WHERE id = p_ride_id;

  -- Commander = active G-Lead of the ride's territory.
  IF v_territory_id IS NOT NULL THEN
    SELECT user_id INTO v_commander_id
    FROM public.pod_commanders
    WHERE territory_id = v_territory_id AND status = 'active'
    LIMIT 1;
  END IF;

  -- Merchant (defensive — schema-tolerant; null if not applicable).
  BEGIN
    SELECT m.created_by INTO v_merchant_id
    FROM public.rides r
    JOIN public.merchants m ON m.id = r.billed_to_merchant_id
    WHERE r.id = p_ride_id;
  EXCEPTION WHEN others THEN
    v_merchant_id := NULL;
  END;

  -- Referrer (defensive — driver's recruiter, null if no referral data).
  BEGIN
    SELECT referrer_user_id INTO v_referrer_id
    FROM public.driver_referrals
    WHERE referred_driver_id = v_driver_id
    LIMIT 1;
  EXCEPTION WHEN others THEN
    v_referrer_id := NULL;
  END;

  INSERT INTO public.ecosystem_pool_ledger (ride_id, beneficiary_type, beneficiary_id, pct, gross_cents, amount_cents)
  VALUES
    (p_ride_id, 'platform',  NULL,          7.00, p_gross_cents, ROUND(p_gross_cents * 0.07)),
    (p_ride_id, 'commander', v_commander_id,4.00, p_gross_cents, ROUND(p_gross_cents * 0.04)),
    (p_ride_id, 'merchant',  v_merchant_id, 3.00, p_gross_cents, ROUND(p_gross_cents * 0.03)),
    (p_ride_id, 'referral',  v_referrer_id, 3.00, p_gross_cents, ROUND(p_gross_cents * 0.03))
  ON CONFLICT (ride_id, beneficiary_type) DO NOTHING;
END; $$;

-- 5e. Settlement grace sweep — expires stale split escrows + settles matured
--     14-day pool entries. Called by cron every 5 minutes.
CREATE OR REPLACE FUNCTION public.process_settlement_grace()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_expired_sessions int;
  v_settled_pool     int;
BEGIN
  -- Auto-reverse split sessions that never confirmed before their window closed.
  UPDATE public.split_sessions
     SET status = 'expired'
   WHERE status = 'collecting' AND expires_at < now();
  GET DIAGNOSTICS v_expired_sessions = ROW_COUNT;

  -- Mature the 17% ecosystem pool entries whose 14-day lock has elapsed.
  UPDATE public.ecosystem_pool_ledger
     SET status = 'settled', settled_at = now()
   WHERE status = 'pending' AND settle_at <= now();
  GET DIAGNOSTICS v_settled_pool = ROW_COUNT;

  RETURN jsonb_build_object(
    'expired_split_sessions', v_expired_sessions,
    'settled_pool_entries', v_settled_pool,
    'swept_at', now()
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.is_verified_location(double precision, double precision) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_coordinate_inside_active_zones(double precision, double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.seed_zone(double precision, double precision, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_pool_entry(uuid, bigint, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_settlement_grace() TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.wallets               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.split_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.split_participants    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_zones          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seeded_zones          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ecosystem_pool_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_queue           ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wallets read own"        ON public.wallets FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "wallets service"         ON public.wallets FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "split_sessions read own" ON public.split_sessions FOR SELECT
  USING (creator_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.split_participants sp WHERE sp.session_id = id AND sp.user_id = auth.uid()));
CREATE POLICY "split_sessions service"  ON public.split_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "split_participants read own" ON public.split_participants FOR SELECT
  USING (user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.split_sessions s WHERE s.id = session_id AND s.creator_id = auth.uid()));
CREATE POLICY "split_participants service"  ON public.split_participants FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Active zones are public read (rider apps need to render coverage); writes = service.
CREATE POLICY "active_zones read"    ON public.active_zones FOR SELECT USING (true);
CREATE POLICY "active_zones service" ON public.active_zones FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "seeded_zones admin" ON public.seeded_zones FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "seeded_zones service" ON public.seeded_zones FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "pool read own" ON public.ecosystem_pool_ledger FOR SELECT
  USING (beneficiary_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "pool service" ON public.ecosystem_pool_ledger FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "event_queue service" ON public.event_queue FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ════════════════════════════════════════════════════════════════════════
-- CRON (guarded; mirrors 20260618 pattern)
-- ════════════════════════════════════════════════════════════════════════
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN

    -- Event queue worker — every 60 seconds.
    DO $cronguard$ BEGIN
      IF current_setting('cron.database_name', true) IS NOT DISTINCT FROM current_database() THEN
        PERFORM cron.unschedule('process-event-queue-1min')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-event-queue-1min');
      ELSE
        RAISE NOTICE 'pg_cron not operational in % — skipping cron op', current_database();
      END IF;
    END $cronguard$;
    DO $cronguard$ BEGIN
      IF current_setting('cron.database_name', true) IS NOT DISTINCT FROM current_database() THEN
        PERFORM cron.schedule(
      'process-event-queue-1min',
      '* * * * *',
      $$SELECT net.http_post(
        url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/process_event_queue',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := '{}'::jsonb
      )$$
    );
      ELSE
        RAISE NOTICE 'pg_cron not operational in % — skipping cron op', current_database();
      END IF;
    END $cronguard$;

    -- Settlement grace sweep — every 5 minutes (calls the DB RPC directly).
    DO $cronguard$ BEGIN
      IF current_setting('cron.database_name', true) IS NOT DISTINCT FROM current_database() THEN
        PERFORM cron.unschedule('settlement-grace-sweep-5min')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'settlement-grace-sweep-5min');
      ELSE
        RAISE NOTICE 'pg_cron not operational in % — skipping cron op', current_database();
      END IF;
    END $cronguard$;
    DO $cronguard$ BEGIN
      IF current_setting('cron.database_name', true) IS NOT DISTINCT FROM current_database() THEN
        PERFORM cron.schedule(
      'settlement-grace-sweep-5min',
      '*/5 * * * *',
      $$SELECT public.process_settlement_grace()$$
    );
      ELSE
        RAISE NOTICE 'pg_cron not operational in % — skipping cron op', current_database();
      END IF;
    END $cronguard$;

  END IF;
END;
$cron$;
