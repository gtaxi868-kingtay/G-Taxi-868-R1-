-- ═══════════════════════════════════════════════════════════════════════════
-- BYD Lease: Three Bug Fixes
-- Migration: 20260621000000_lease_escrow_and_consent
--
-- Fix 1: deduct_lease_installment_for_ride(p_ride_id UUID) — single-param
--   overload. complete_ride/index.ts calls with { p_ride_id } only; the
--   existing 3-param signature (p_lease_id, p_ride_id, p_gross_cents) never
--   matched, so zero lease deductions occurred in production.
--
-- Fix 2: bank_lease_escrow table — installment is routed to escrow before
--   being wired to the bank weekly. The deduction never enters the driver's
--   general wallet, satisfying the bank MOU "irrevocable assignment at source"
--   requirement. admin_settle_bank_escrow() generates the weekly wire batch.
--
-- Fix 3: lease_consent_log table + record_driver_lease_consent() RPC.
--   Driver must sign the earnings-assignment addendum in-app before admin
--   can activate a lease. Stores version, timestamp, device info.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. bank_lease_escrow ─────────────────────────────────────────────────
-- Each row = one ride's lease installment held in escrow.
-- settled_at / wire_batch_id are set by admin_settle_bank_escrow().

CREATE TABLE IF NOT EXISTS public.bank_lease_escrow (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id      UUID        NOT NULL REFERENCES fleet_leases(id) ON DELETE CASCADE,
  driver_id     UUID        NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  ride_id       UUID        REFERENCES rides(id) ON DELETE SET NULL,
  amount_cents  INTEGER     NOT NULL CHECK (amount_cents > 0),
  wire_batch_id UUID,
  settled_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_escrow_ride_unique
  ON public.bank_lease_escrow(ride_id) WHERE ride_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bank_escrow_unsettled
  ON public.bank_lease_escrow(created_at) WHERE settled_at IS NULL;

ALTER TABLE public.bank_lease_escrow ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'service manages escrow' AND tablename = 'bank_lease_escrow'
  ) THEN
    CREATE POLICY "service manages escrow"
      ON public.bank_lease_escrow FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END; $$;

-- ── 2. lease_consent_log ─────────────────────────────────────────────────
-- Append-only. Each row = one consent signing event.

CREATE TABLE IF NOT EXISTS public.lease_consent_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   UUID        NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  version     TEXT        NOT NULL DEFAULT '1.0',
  signed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  device_info JSONB       NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_lease_consent_driver
  ON public.lease_consent_log(driver_id, signed_at DESC);

ALTER TABLE public.lease_consent_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'driver reads own consent' AND tablename = 'lease_consent_log'
  ) THEN
    CREATE POLICY "driver reads own consent"
      ON public.lease_consent_log FOR SELECT
      USING (driver_id IN (SELECT id FROM drivers WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'service manages consent' AND tablename = 'lease_consent_log'
  ) THEN
    CREATE POLICY "service manages consent"
      ON public.lease_consent_log FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END; $$;

-- ── 3. fleet_leases: consent tracking columns ────────────────────────────
ALTER TABLE public.fleet_leases
  ADD COLUMN IF NOT EXISTS consent_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_version   TEXT;

-- ── 4. RPC: record_driver_lease_consent ──────────────────────────────────
-- Called from LeaseConsentScreen after driver reads and accepts the addendum.
-- Verifies qualification, appends to consent log, returns signed_at.

CREATE OR REPLACE FUNCTION public.record_driver_lease_consent(
  p_driver_id   UUID,
  p_version     TEXT  DEFAULT '1.0',
  p_device_info JSONB DEFAULT '{}'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_qualified BOOLEAN;
  v_signed_at TIMESTAMPTZ := now();
BEGIN
  SELECT qualified INTO v_qualified
  FROM public.driver_lease_eligibility WHERE driver_id = p_driver_id;

  IF NOT FOUND OR NOT v_qualified THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Driver has not yet qualified for a lease (90 active days required)'
    );
  END IF;

  INSERT INTO public.lease_consent_log (driver_id, version, signed_at, device_info)
  VALUES (p_driver_id, COALESCE(p_version, '1.0'), v_signed_at, COALESCE(p_device_info, '{}'));

  RETURN jsonb_build_object(
    'success',    true,
    'signed_at',  v_signed_at,
    'version',    COALESCE(p_version, '1.0')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_driver_lease_consent(UUID, TEXT, JSONB)
  TO service_role, authenticated;

-- ── 5. RPC: deduct_lease_installment_for_ride(p_ride_id UUID) ───────────
-- Single-param overload that auto-resolves everything from the ride row.
-- complete_ride/index.ts calls .rpc("deduct_lease_installment_for_ride", { p_ride_id: ride_id })
-- which now matches this signature instead of silently failing.
--
-- Routing: installment → bank_lease_escrow (NOT driver wallet_transactions).
-- The driver never receives this slice; the bank sees it as salary-style
-- deduction at source, satisfying the MOU's irrevocable-assignment clause.

CREATE OR REPLACE FUNCTION public.deduct_lease_installment_for_ride(p_ride_id UUID)
RETURNS TABLE (
  success         BOOLEAN,
  deduction_cents INTEGER,
  error_message   TEXT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_driver_id   UUID;
  v_gross_cents INTEGER;
  v_lease       RECORD;
  v_installment INTEGER;
BEGIN
  -- Resolve driver and gross fare from ride
  SELECT driver_id, COALESCE(total_fare_cents, 0)
  INTO v_driver_id, v_gross_cents
  FROM public.rides WHERE id = p_ride_id;

  IF NOT FOUND OR v_driver_id IS NULL THEN
    RETURN QUERY SELECT false, 0, 'Ride or driver not found'::text;
    RETURN;
  END IF;

  -- Idempotency: already processed for this ride?
  IF EXISTS (SELECT 1 FROM public.bank_lease_escrow WHERE ride_id = p_ride_id) THEN
    SELECT amount_cents INTO v_installment
    FROM public.bank_lease_escrow WHERE ride_id = p_ride_id LIMIT 1;
    RETURN QUERY SELECT true, COALESCE(v_installment, 0), NULL::text;
    RETURN;
  END IF;

  -- Fetch and lock the driver's active lease (blocks concurrent calls for same driver)
  SELECT id, per_ride_installment_cents
  INTO v_lease
  FROM public.fleet_leases
  WHERE driver_id = v_driver_id
    AND status = 'active'
    AND NOT COALESCE(dispute_open, false)
  FOR UPDATE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, 'No active lease or dispute open'::text;
    RETURN;
  END IF;

  -- Installment = min(configured per-ride amount, 15% cap on gross fare)
  v_installment := LEAST(
    COALESCE(v_lease.per_ride_installment_cents, 5000),
    (ROUND(v_gross_cents * 0.15))::integer
  );

  IF v_installment <= 0 THEN
    RETURN QUERY SELECT false, 0, 'Fare too small for installment deduction'::text;
    RETURN;
  END IF;

  -- Append to lease_payments for driver-facing history (dedup on ride_id index)
  INSERT INTO public.lease_payments (lease_id, ride_id, amount_cents, status)
  VALUES (v_lease.id, p_ride_id, v_installment, 'paid')
  ON CONFLICT DO NOTHING;

  -- Route to bank escrow — never credited to driver wallet
  INSERT INTO public.bank_lease_escrow (lease_id, driver_id, ride_id, amount_cents)
  VALUES (v_lease.id, v_driver_id, p_ride_id, v_installment)
  ON CONFLICT (ride_id) DO NOTHING;

  RETURN QUERY SELECT true, v_installment, NULL::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.deduct_lease_installment_for_ride(UUID) TO service_role;

-- ── 6. RPC: admin_settle_bank_escrow ─────────────────────────────────────
-- Mark all unsettled escrow entries as wired. Run weekly.
-- Returns a batch UUID + total cents so admin can verify against bank receipt.

CREATE OR REPLACE FUNCTION public.admin_settle_bank_escrow()
RETURNS TABLE (
  batch_id      UUID,
  settled_count INTEGER,
  total_cents   BIGINT,
  settled_at    TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_batch UUID        := gen_random_uuid();
  v_now   TIMESTAMPTZ := now();
  v_count INTEGER;
  v_total BIGINT;
BEGIN
  UPDATE public.bank_lease_escrow
  SET wire_batch_id = v_batch, settled_at = v_now
  WHERE settled_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_total
  FROM public.bank_lease_escrow WHERE wire_batch_id = v_batch;

  RETURN QUERY SELECT v_batch, v_count, v_total, v_now;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_settle_bank_escrow() TO service_role;
