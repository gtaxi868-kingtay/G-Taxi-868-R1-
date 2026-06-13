-- ============================================================
-- ROCKEFELLER COMPOUNDING LAYER
-- Fixes 3 bugs + activates 4 revenue features
-- Applied: 2026-06-12
-- ============================================================

-- ── BUG FIX 1: deduct_daily_lease_fee (single-lease RPC) ────
-- fleet_lease_engine/index.ts:264 calls this but it never existed.
-- Wraps the batch logic for a single lease_id.
CREATE OR REPLACE FUNCTION deduct_daily_lease_fee(
    p_lease_id UUID,
    p_date     DATE DEFAULT CURRENT_DATE
) RETURNS TABLE (
    lease_id     UUID,
    success      BOOLEAN,
    amount_cents INTEGER,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_platform_id UUID := '00000000-0000-0000-0000-000000000000';
    v_lease RECORD;
    v_driver_user_id UUID;
    v_balance INTEGER;
    v_wallet_txn_id UUID;
BEGIN
    SELECT fl.id, fl.daily_rate_cents, fl.lease_type, d.user_id
    INTO v_lease
    FROM fleet_leases fl
    JOIN drivers d ON d.id = fl.driver_id
    WHERE fl.id = p_lease_id
      AND fl.status = 'active'
      AND fl.lease_type IN ('daily', 'hybrid')
      AND NOT EXISTS (
          SELECT 1 FROM lease_payments lp
          WHERE lp.lease_id = fl.id
            AND lp.billing_period_start <= p_date
            AND lp.billing_period_end >= p_date
            AND lp.deduction_type = 'daily'
            AND lp.status = 'deducted'
      );

    IF NOT FOUND THEN
        RETURN QUERY SELECT p_lease_id, false, 0, 'Lease not found, inactive, or already processed today'::TEXT;
        RETURN;
    END IF;

    v_driver_user_id := v_lease.user_id;

    SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM wallet_transactions WHERE user_id = v_driver_user_id;

    IF v_balance < v_lease.daily_rate_cents THEN
        INSERT INTO lease_payments (
            lease_id, amount_cents, deduction_type,
            billing_period_start, billing_period_end, status, metadata
        ) VALUES (
            p_lease_id, v_lease.daily_rate_cents, 'daily',
            p_date, p_date, 'failed',
            jsonb_build_object('error', 'Insufficient balance', 'balance_cents', v_balance)
        );
        RETURN QUERY SELECT p_lease_id, false, v_lease.daily_rate_cents, 'Insufficient balance'::TEXT;
        RETURN;
    END IF;

    INSERT INTO wallet_transactions (user_id, amount, transaction_type, description, status)
    VALUES (v_driver_user_id, -v_lease.daily_rate_cents, 'lease_deduction',
            format('Daily fleet lease fee (%s)', p_date), 'completed')
    RETURNING id INTO v_wallet_txn_id;

    INSERT INTO wallet_transactions (user_id, amount, transaction_type, description, status)
    VALUES (v_platform_id, v_lease.daily_rate_cents, 'lease_income',
            format('Daily fleet lease income (%s)', p_date), 'completed');

    INSERT INTO lease_payments (
        lease_id, amount_cents, deduction_type,
        billing_period_start, billing_period_end,
        status, deducted_from_ride, deducted_at, wallet_transaction_id
    ) VALUES (
        p_lease_id, v_lease.daily_rate_cents, 'daily',
        p_date, p_date, 'deducted', false, now(), v_wallet_txn_id
    );

    RETURN QUERY SELECT p_lease_id, true, v_lease.daily_rate_cents, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION deduct_daily_lease_fee(UUID, DATE) TO service_role;

-- ── BUG FIX 2: Capital reserve query RPC ────────────────────
CREATE OR REPLACE FUNCTION admin_get_reserve_balance()
RETURNS TABLE (
    total_locked_cents    BIGINT,
    total_deployed_cents  BIGINT,
    total_released_cents  BIGINT,
    net_available_cents   BIGINT,
    ride_count            BIGINT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT
        COALESCE(SUM(CASE WHEN status = 'locked'   THEN amount_cents ELSE 0 END), 0) AS total_locked_cents,
        COALESCE(SUM(CASE WHEN status = 'deployed' THEN amount_cents ELSE 0 END), 0) AS total_deployed_cents,
        COALESCE(SUM(CASE WHEN status = 'released' THEN amount_cents ELSE 0 END), 0) AS total_released_cents,
        COALESCE(SUM(CASE WHEN status = 'locked'   THEN amount_cents ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN status = 'deployed' THEN amount_cents ELSE 0 END), 0) AS net_available_cents,
        COUNT(*) AS ride_count
    FROM capital_reserve_ledger;
$$;

GRANT EXECUTE ON FUNCTION admin_get_reserve_balance() TO service_role;

-- ── BUG FIX 3: Merchant commission wallet credit ─────────────
CREATE OR REPLACE FUNCTION credit_merchant_commission(
    p_merchant_id    UUID,
    p_ride_id        UUID,
    p_amount_cents   INTEGER
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    SELECT created_by INTO v_user_id FROM merchants WHERE id = p_merchant_id;
    IF v_user_id IS NULL THEN RETURN; END IF;

    INSERT INTO wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
    VALUES (v_user_id, p_ride_id, p_amount_cents, 'merchant_commission',
            'Vendor kiosk commission (3%)', 'completed');
END;
$$;

GRANT EXECUTE ON FUNCTION credit_merchant_commission(UUID, UUID, INTEGER) TO service_role;

-- ── REVENUE FEATURE 1: Surge pricing activation ──────────────
CREATE OR REPLACE FUNCTION admin_set_surge_zone(
    p_lat         DOUBLE PRECISION,
    p_lng         DOUBLE PRECISION,
    p_radius_km   DOUBLE PRECISION,
    p_multiplier  NUMERIC,
    p_expires_at  TIMESTAMPTZ DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO pricing_zones (
        name, center_lat, center_lng, radius_km,
        surge_multiplier, is_active, expires_at, created_at
    ) VALUES (
        format('Auto surge %.1fx @ %s,%s', p_multiplier, round(p_lat::numeric,4), round(p_lng::numeric,4)),
        p_lat, p_lng, p_radius_km,
        p_multiplier, true,
        COALESCE(p_expires_at, now() + interval '2 hours'),
        now()
    )
    ON CONFLICT (name) DO UPDATE
        SET surge_multiplier = EXCLUDED.surge_multiplier,
            is_active = true,
            expires_at = EXCLUDED.expires_at
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_set_surge_zone(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION expire_surge_zones() RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count INTEGER;
BEGIN
    UPDATE pricing_zones SET is_active = false
    WHERE is_active = true AND expires_at IS NOT NULL AND expires_at < now();
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION expire_surge_zones() TO service_role;

-- ── REVENUE FEATURE 2: Referral system ───────────────────────
CREATE TABLE IF NOT EXISTS public.referral_codes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    code        TEXT NOT NULL UNIQUE,
    type        TEXT NOT NULL CHECK (type IN ('driver', 'rider')),
    uses        INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.referral_earnings (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id  UUID NOT NULL REFERENCES auth.users(id),
    referee_id   UUID NOT NULL REFERENCES auth.users(id),
    type         TEXT NOT NULL CHECK (type IN ('driver', 'rider')),
    ride_id      UUID REFERENCES public.rides(id),
    amount_cents INTEGER NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired')),
    expires_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_earnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own referral code"
    ON public.referral_codes FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Service manages referral codes"
    ON public.referral_codes FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Users see own earnings"
    ON public.referral_earnings FOR SELECT USING (referrer_id = auth.uid() OR referee_id = auth.uid());
CREATE POLICY "Service manages referral earnings"
    ON public.referral_earnings FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_referral_codes_user ON public.referral_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON public.referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referral_earnings_referrer ON public.referral_earnings(referrer_id);

CREATE OR REPLACE FUNCTION generate_referral_code(p_user_id UUID, p_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_code TEXT;
    v_attempts INT := 0;
BEGIN
    LOOP
        v_code := upper(substring(md5(p_user_id::text || clock_timestamp()::text) from 1 for 6));
        EXIT WHEN NOT EXISTS (SELECT 1 FROM referral_codes WHERE code = v_code);
        v_attempts := v_attempts + 1;
        IF v_attempts > 20 THEN RAISE EXCEPTION 'Could not generate unique code'; END IF;
    END LOOP;

    INSERT INTO referral_codes (user_id, code, type)
    VALUES (p_user_id, v_code, p_type)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN v_code;
END;
$$;
GRANT EXECUTE ON FUNCTION generate_referral_code(UUID, TEXT) TO service_role, authenticated;

CREATE OR REPLACE FUNCTION apply_referral_code(
    p_referee_id UUID,
    p_code TEXT,
    p_type TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_referrer_id UUID;
    v_credit INTEGER := 1500; -- TTD $15.00 in cents
BEGIN
    SELECT user_id INTO v_referrer_id FROM referral_codes WHERE code = upper(p_code) AND type = p_type;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code'); END IF;
    IF v_referrer_id = p_referee_id THEN RETURN jsonb_build_object('success', false, 'error', 'Cannot use own code'); END IF;
    IF EXISTS (SELECT 1 FROM referral_earnings WHERE referee_id = p_referee_id AND type = p_type) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Referral already used');
    END IF;

    INSERT INTO wallet_transactions (user_id, amount, transaction_type, description, status)
    VALUES
        (v_referrer_id, v_credit, 'bonus', format('Referral bonus — new %s signup', p_type), 'completed'),
        (p_referee_id,  v_credit, 'bonus', 'Welcome bonus — referral code applied', 'completed');

    INSERT INTO referral_earnings (referrer_id, referee_id, type, amount_cents, status, expires_at)
    VALUES (v_referrer_id, p_referee_id, p_type, v_credit, 'paid', now() + interval '90 days');

    UPDATE referral_codes SET uses = uses + 1 WHERE code = upper(p_code);

    RETURN jsonb_build_object('success', true, 'referrer_id', v_referrer_id, 'credit_cents', v_credit);
END;
$$;
GRANT EXECUTE ON FUNCTION apply_referral_code(UUID, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION check_driver_referral_commission(
    p_driver_user_id UUID,
    p_ride_id        UUID,
    p_platform_fee_cents INTEGER
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_referrer_id UUID;
    v_commission INTEGER;
BEGIN
    SELECT referrer_id INTO v_referrer_id
    FROM referral_earnings
    WHERE referee_id = p_driver_user_id
      AND type = 'driver'
      AND status = 'paid'
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1;

    IF NOT FOUND THEN RETURN 0; END IF;

    v_commission := GREATEST(1, floor(p_platform_fee_cents * 0.01));

    INSERT INTO wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
    VALUES (v_referrer_id, p_ride_id, v_commission, 'bonus',
            'Driver referral commission (1% of platform fee)', 'completed');

    RETURN v_commission;
END;
$$;
GRANT EXECUTE ON FUNCTION check_driver_referral_commission(UUID, UUID, INTEGER) TO service_role;

-- ── REVENUE FEATURE 3: Loyalty rate tier ─────────────────────
CREATE OR REPLACE FUNCTION driver_qualifies_loyalty_rate(p_driver_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT COALESCE(SUM(amount), 0) >= 50000
    FROM wallet_transactions
    WHERE user_id = p_driver_user_id;
$$;
GRANT EXECUTE ON FUNCTION driver_qualifies_loyalty_rate(UUID) TO service_role;
