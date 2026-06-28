-- ════════════════════════════════════════════════════════════════════════
-- TERRITORY / POD-COMMANDER FOUNDATION
-- ════════════════════════════════════════════════════════════════════════
-- This migration creates the three core tables the Pod Commander subsystem
-- depends on. It MUST run before 20260630000005+ (puck_events, territory
-- links, metrics snapshot, succession, driver advancement), all of which
-- reference territories(id) and pod_commanders as if they already existed.
--
-- Data-truth model (two tables, clean handoff):
--   commander_applications  → public submissions from the rider app.
--                             Normalised columns, NOT a JSON blob. One job:
--                             hold a pending request until an admin decides.
--   pod_commanders          → ONLY active/managed commanders. A row here is
--                             created by an admin approving an application.
--
-- profiles.role is TEXT (not an enum). We use plain text role strings
-- ('admin', 'pod_commander', ...) everywhere — no ::user_role cast.
-- ════════════════════════════════════════════════════════════════════════

-- ─── TERRITORIES ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS territories (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  code             text NOT NULL UNIQUE,
  region_id        text,
  boundary_geojson jsonb,
  commander_id     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  is_active        boolean NOT NULL DEFAULT true,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_territories_commander ON territories(commander_id);

-- ─── COMMANDER ONBOARDING CODE GENERATOR ─────────────────────────────────
-- register_driver_with_code / merchant_register_with_code attach a new
-- driver/merchant to a commander by looking up pod_commanders.onboarding_code.
-- Generate one automatically on every insert so the code is NEVER null —
-- this is the join key for the entire recruit flow. 8 chars, ambiguity-free
-- alphabet, loops until unique.
CREATE OR REPLACE FUNCTION gen_commander_code()
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_code     text;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i          int;
BEGIN
  LOOP
    v_code := '';
    FOR i IN 1..8 LOOP
      v_code := v_code || substr(v_alphabet, floor(random() * length(v_alphabet))::int + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.pod_commanders WHERE onboarding_code = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

-- ─── POD COMMANDERS (active commanders only) ─────────────────────────────
CREATE TABLE IF NOT EXISTS pod_commanders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  territory_id    uuid REFERENCES territories(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','active','inactive','suspended')),
  onboarding_code text NOT NULL UNIQUE DEFAULT gen_commander_code(),
  metrics         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pod_commanders_user ON pod_commanders(user_id);
CREATE INDEX IF NOT EXISTS idx_pod_commanders_territory ON pod_commanders(territory_id);

-- ─── COMMANDER APPLICATIONS (public submissions) ─────────────────────────
-- Explicit state machine: pending → approved | rejected.
-- Form fields are first-class columns, never buried in JSON.
CREATE TABLE IF NOT EXISTS commander_applications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  full_name     text NOT NULL,
  phone         text NOT NULL,
  whatsapp      text,
  area          text NOT NULL,
  current_role  text,
  reasoning     text NOT NULL,
  referral_code text,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),
  reviewed_by   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at   timestamptz,
  review_notes  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commander_apps_user ON commander_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_commander_apps_status ON commander_applications(status);

-- One open application per user: cannot re-apply while a request is pending.
CREATE UNIQUE INDEX IF NOT EXISTS idx_commander_apps_one_pending
  ON commander_applications(user_id)
  WHERE status = 'pending';

-- ─── system_alerts: allow commander succession alert types ───────────────
-- The succession trigger (20260630000008) raises COMMANDER_SUCCESSION /
-- COMMANDER_ORPHANED alerts. system_alerts' type CHECK predates them, so
-- widen it here (this migration runs first) or the trigger — and therefore
-- any commander DELETE — would fail the CHECK.
ALTER TABLE system_alerts DROP CONSTRAINT IF EXISTS system_alerts_type_check;
ALTER TABLE system_alerts ADD CONSTRAINT system_alerts_type_check CHECK (type IN (
  'RECONCILIATION_FAILURE',
  'PAYMENT_ANOMALY',
  'GPS_SPOOF_ESCALATION',
  'STATE_MACHINE_VIOLATION',
  'RATE_LIMIT_BURST',
  'ADMIN_OVERRIDE',
  'COMMANDER_SUCCESSION',
  'COMMANDER_ORPHANED'
));

-- ─── kiosk_nodes.territory_id ────────────────────────────────────────────
-- commander_get_territory filters kiosk_nodes by territory_id; the column
-- was never added. Add it here so puck queries resolve.
ALTER TABLE kiosk_nodes ADD COLUMN IF NOT EXISTS territory_id uuid REFERENCES territories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_kiosk_nodes_territory ON kiosk_nodes(territory_id);

-- ─── updated_at trigger ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_territories_updated_at ON territories;
CREATE TRIGGER trg_territories_updated_at
  BEFORE UPDATE ON territories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_pod_commanders_updated_at ON pod_commanders;
CREATE TRIGGER trg_pod_commanders_updated_at
  BEFORE UPDATE ON pod_commanders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════════════

-- ─── territories ─────────────────────────────────────────────────────────
ALTER TABLE territories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "territories admins full access"
  ON territories
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

CREATE POLICY "territories commanders read own"
  ON territories
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pod_commanders pc
      WHERE pc.user_id = auth.uid() AND pc.territory_id = territories.id
    )
  );

CREATE POLICY "territories service role full access"
  ON territories
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─── pod_commanders ──────────────────────────────────────────────────────
ALTER TABLE pod_commanders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pod_commanders admins full access"
  ON pod_commanders
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

-- A commander may read their own row only. Inserts/updates flow exclusively
-- through edge functions (service role) — clients never write here directly.
CREATE POLICY "pod_commanders read own"
  ON pod_commanders
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "pod_commanders service role full access"
  ON pod_commanders
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─── commander_applications ──────────────────────────────────────────────
ALTER TABLE commander_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "commander_apps admins full access"
  ON commander_applications
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

-- An authenticated user may submit an application for THEMSELVES only.
CREATE POLICY "commander_apps insert own"
  ON commander_applications
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- An applicant may read the status of their own applications.
CREATE POLICY "commander_apps read own"
  ON commander_applications
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "commander_apps service role full access"
  ON commander_applications
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
