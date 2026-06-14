-- ============================================================
-- SURGE ZONES + RESERVE ENHANCEMENTS
-- 1. Adds center_lat/lng/radius to pricing_zones for point-in-zone checks
-- 2. Adds get_surge_multiplier_for_point RPC (PostGIS)
-- 3. Adds source_booking_id to capital_reserve_ledger for travel bookings
-- 4. Adds source column to capital_reserve_ledger
-- 5. Scout referral auto-payout trigger
-- ============================================================

-- 1. Upgrade pricing_zones with geographic center + radius
ALTER TABLE pricing_zones
    ADD COLUMN IF NOT EXISTS center_lat    NUMERIC(10,7),
    ADD COLUMN IF NOT EXISTS center_lng    NUMERIC(10,7),
    ADD COLUMN IF NOT EXISTS radius_meters INTEGER NOT NULL DEFAULT 2000,
    ADD COLUMN IF NOT EXISTS reason        TEXT,
    ADD COLUMN IF NOT EXISTS expires_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_by    UUID REFERENCES auth.users(id);

-- Auto-deactivate expired zones
CREATE OR REPLACE FUNCTION deactivate_expired_surge_zones()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE pricing_zones
  SET is_active = false
  WHERE is_active = true
    AND expires_at IS NOT NULL
    AND expires_at < now();
END;
$$;

-- 2. PostGIS point-in-zone RPC — returns highest active multiplier for pickup point
CREATE OR REPLACE FUNCTION get_surge_multiplier_for_point(p_lat NUMERIC, p_lng NUMERIC)
RETURNS NUMERIC LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_multiplier NUMERIC := 1.0;
BEGIN
  SELECT COALESCE(MAX(multiplier), 1.0)
  INTO v_multiplier
  FROM pricing_zones
  WHERE is_active = true
    AND (expires_at IS NULL OR expires_at > now())
    AND center_lat IS NOT NULL
    AND center_lng IS NOT NULL
    AND (
      -- Haversine in SQL using earth_distance approximation
      6371000 * 2 * ASIN(
        SQRT(
          POWER(SIN((p_lat - center_lat) * PI() / 180 / 2), 2) +
          COS(p_lat * PI() / 180) * COS(center_lat * PI() / 180) *
          POWER(SIN((p_lng - center_lng) * PI() / 180 / 2), 2)
        )
      ) <= radius_meters
    );
  RETURN COALESCE(v_multiplier, 1.0);
END;
$$;

-- 3. capital_reserve_ledger: add source_booking_id and source column
ALTER TABLE capital_reserve_ledger
    ADD COLUMN IF NOT EXISTS source_booking_id UUID,
    ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'ride'
        CHECK (source IN ('ride','travel_package','grocery_order','laundry_order','manual'));

CREATE INDEX IF NOT EXISTS idx_capital_reserve_source_booking
    ON capital_reserve_ledger(source_booking_id) WHERE source_booking_id IS NOT NULL;

-- 4. Scout referral auto-payout trigger
-- When driver_scout_referrals.status -> 'qualified', credit TTD $500 to driver wallet
CREATE OR REPLACE FUNCTION auto_payout_scout_referral()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_driver_user_id UUID;
  v_wallet_id UUID;
BEGIN
  -- Only fire when status transitions to 'qualified'
  IF NEW.status <> 'qualified' OR OLD.status = 'qualified' THEN
    RETURN NEW;
  END IF;

  -- Get driver's auth user_id
  SELECT user_id INTO v_driver_user_id
  FROM drivers
  WHERE id = NEW.driver_id;

  IF v_driver_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get or create wallet
  SELECT id INTO v_wallet_id
  FROM wallets
  WHERE user_id = v_driver_user_id;

  IF v_wallet_id IS NULL THEN
    INSERT INTO wallets (user_id, balance_cents)
    VALUES (v_driver_user_id, NEW.payout_amount_cents)
    RETURNING id INTO v_wallet_id;
  ELSE
    UPDATE wallets
    SET balance_cents = balance_cents + NEW.payout_amount_cents
    WHERE id = v_wallet_id;
  END IF;

  -- Record wallet transaction
  INSERT INTO wallet_transactions (
    user_id, amount, transaction_type, description, status, reference_id
  ) VALUES (
    v_driver_user_id,
    NEW.payout_amount_cents,
    'scout_referral_payout',
    FORMAT('Scout referral payout: %s qualified', COALESCE(NEW.property_name, 'Property lead')),
    'completed',
    NEW.id::TEXT
  ) RETURNING id INTO NEW.wallet_txn_id;

  -- Update referral to paid
  NEW.status := 'paid';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_payout_scout_referral ON driver_scout_referrals;
CREATE TRIGGER trg_auto_payout_scout_referral
  BEFORE UPDATE ON driver_scout_referrals
  FOR EACH ROW
  EXECUTE FUNCTION auto_payout_scout_referral();

-- 5. Loyalty tier threshold in system config (admin-configurable)
INSERT INTO system_feature_flags (id, is_active, metadata)
VALUES (
  'loyalty_tier_threshold_cents',
  true,
  '{"value": 50000, "description": "Driver wallet balance threshold (cents) for 16% loyalty rate. Default TTD $500."}'
)
ON CONFLICT (id) DO NOTHING;

-- 6. RPC: admin can get reserve balance
CREATE OR REPLACE FUNCTION admin_get_reserve_balance()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_locked  BIGINT;
  v_deployed BIGINT;
  v_released BIGINT;
  v_total   BIGINT;
BEGIN
  SELECT
    SUM(CASE WHEN status = 'locked'   THEN amount_cents ELSE 0 END),
    SUM(CASE WHEN status = 'deployed' THEN amount_cents ELSE 0 END),
    SUM(CASE WHEN status = 'released' THEN amount_cents ELSE 0 END),
    SUM(amount_cents)
  INTO v_locked, v_deployed, v_released, v_total
  FROM capital_reserve_ledger;

  RETURN jsonb_build_object(
    'locked_cents',   COALESCE(v_locked, 0),
    'deployed_cents', COALESCE(v_deployed, 0),
    'released_cents', COALESCE(v_released, 0),
    'total_cents',    COALESCE(v_total, 0),
    'by_source', (
      SELECT jsonb_object_agg(source, total)
      FROM (
        SELECT COALESCE(source, 'ride') AS source, SUM(amount_cents) AS total
        FROM capital_reserve_ledger
        GROUP BY source
      ) s
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_reserve_balance() TO service_role;
GRANT EXECUTE ON FUNCTION get_surge_multiplier_for_point(NUMERIC, NUMERIC) TO service_role, authenticated;
