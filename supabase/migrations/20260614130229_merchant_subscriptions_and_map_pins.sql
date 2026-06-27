-- Merchant subscription model: 90-day free trial → TTD $150/month
-- Billing deducted from merchant wallet by pg_cron daily

CREATE TABLE IF NOT EXISTS merchant_subscriptions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id         UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    trial_start_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    trial_end_at        TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '90 days',
    status              TEXT NOT NULL DEFAULT 'trial'
                        CHECK (status IN ('trial','active','overdue','suspended','cancelled')),
    monthly_fee_cents   INTEGER NOT NULL DEFAULT 15000,  -- TTD $150
    next_billing_at     TIMESTAMPTZ,
    last_billed_at      TIMESTAMPTZ,
    overdue_since       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (merchant_id)
);

ALTER TABLE merchant_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON merchant_subscriptions
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Auto-create a subscription row whenever a merchant is inserted
CREATE OR REPLACE FUNCTION auto_create_merchant_subscription()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO merchant_subscriptions (merchant_id)
    VALUES (NEW.id)
    ON CONFLICT (merchant_id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_merchant_subscription ON merchants;
CREATE TRIGGER trg_auto_merchant_subscription
    AFTER INSERT ON merchants
    FOR EACH ROW EXECUTE FUNCTION auto_create_merchant_subscription();

-- Back-fill existing merchants that have no subscription row yet
INSERT INTO merchant_subscriptions (merchant_id)
SELECT id FROM merchants
WHERE id NOT IN (SELECT merchant_id FROM merchant_subscriptions)
ON CONFLICT (merchant_id) DO NOTHING;

-- ── BILLING RPC ──────────────────────────────────────────────────────────────
-- Called by pg_cron daily at 06:00 UTC.
-- 1. Flips trials that have expired to 'active' and sets first billing date.
-- 2. Charges merchants whose next_billing_at has passed.
-- 3. Marks failures as 'overdue'.
CREATE OR REPLACE FUNCTION process_merchant_billing()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    rec             RECORD;
    v_balance       INTEGER;
    v_charged       INTEGER := 0;
    v_overdue       INTEGER := 0;
    v_activated     INTEGER := 0;
BEGIN
    -- Step 1: Activate expired trials
    UPDATE merchant_subscriptions
    SET
        status         = 'active',
        next_billing_at = now() + INTERVAL '30 days'
    WHERE status = 'trial'
      AND trial_end_at <= now();

    GET DIAGNOSTICS v_activated = ROW_COUNT;

    -- Step 2: Charge active merchants whose billing date has passed
    FOR rec IN
        SELECT ms.id, ms.merchant_id, ms.monthly_fee_cents, m.created_by
        FROM merchant_subscriptions ms
        JOIN merchants m ON m.id = ms.merchant_id
        WHERE ms.status = 'active'
          AND ms.next_billing_at <= now()
    LOOP
        -- Read wallet balance
        SELECT COALESCE(balance_cents, 0)
        INTO v_balance
        FROM wallets
        WHERE user_id = rec.created_by;

        IF v_balance >= rec.monthly_fee_cents THEN
            -- Deduct from wallet
            UPDATE wallets
            SET balance_cents = balance_cents - rec.monthly_fee_cents
            WHERE user_id = rec.created_by;

            INSERT INTO wallet_transactions (
                user_id, amount, transaction_type, description, status
            ) VALUES (
                rec.created_by,
                -rec.monthly_fee_cents,
                'merchant_subscription',
                'G-Taxi merchant listing — monthly fee',
                'completed'
            );

            UPDATE merchant_subscriptions
            SET
                last_billed_at  = now(),
                next_billing_at = now() + INTERVAL '30 days',
                overdue_since   = NULL
            WHERE id = rec.id;

            v_charged := v_charged + 1;
        ELSE
            -- Insufficient balance → mark overdue
            UPDATE merchant_subscriptions
            SET
                status        = 'overdue',
                overdue_since = COALESCE(overdue_since, now())
            WHERE id = rec.id;

            v_overdue := v_overdue + 1;
        END IF;
    END LOOP;

    -- Step 3: Suspend merchants overdue for more than 7 days
    UPDATE merchant_subscriptions
    SET status = 'suspended'
    WHERE status = 'overdue'
      AND overdue_since <= now() - INTERVAL '7 days';

    RETURN jsonb_build_object(
        'activated',  v_activated,
        'charged',    v_charged,
        'overdue',    v_overdue,
        'run_at',     now()
    );
END;
$$;

GRANT EXECUTE ON FUNCTION process_merchant_billing() TO service_role;

-- ── MAP PIN RPC ──────────────────────────────────────────────────────────────
-- Returns all active kiosk nodes with their merchant info for map rendering.
-- Only merchants whose subscription is in 'trial' or 'active' appear on the map.
CREATE OR REPLACE FUNCTION get_merchant_map_pins(
    p_lat        DOUBLE PRECISION,
    p_lng        DOUBLE PRECISION,
    p_radius_km  DOUBLE PRECISION DEFAULT 20
)
RETURNS TABLE (
    kiosk_id        UUID,
    merchant_id     UUID,
    merchant_name   TEXT,
    category        TEXT,
    location_name   TEXT,
    lat             DOUBLE PRECISION,
    lng             DOUBLE PRECISION,
    default_services TEXT[],
    is_open         BOOLEAN,
    distance_meters DOUBLE PRECISION
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT
        k.id                  AS kiosk_id,
        m.id                  AS merchant_id,
        m.name                AS merchant_name,
        m.category,
        k.location_name,
        k.lat,
        k.lng,
        k.default_services,
        m.is_active           AS is_open,
        earth_distance(
            ll_to_earth(p_lat, p_lng),
            ll_to_earth(k.lat, k.lng)
        )                     AS distance_meters
    FROM kiosk_nodes k
    JOIN merchants m ON m.id = k.merchant_id
    JOIN merchant_subscriptions ms ON ms.merchant_id = m.id
    WHERE k.is_active = true
      AND m.is_active = true
      AND ms.status IN ('trial', 'active')
      AND k.lat IS NOT NULL
      AND k.lng IS NOT NULL
      AND earth_distance(
            ll_to_earth(p_lat, p_lng),
            ll_to_earth(k.lat, k.lng)
          ) <= p_radius_km * 1000
    ORDER BY distance_meters ASC;
$$;

GRANT EXECUTE ON FUNCTION get_merchant_map_pins(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO anon, authenticated, service_role;

-- ── pg_cron: run billing daily at 06:00 UTC ──────────────────────────────────
DO $$
BEGIN
    DO $cronguard$ BEGIN
      IF current_setting('cron.database_name', true) IS NOT DISTINCT FROM current_database() THEN
        PERFORM cron.unschedule('merchant-daily-billing');
      ELSE
        RAISE NOTICE 'pg_cron not operational in % — skipping cron op', current_database();
      END IF;
    END $cronguard$;
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

DO $cronguard$ BEGIN
  IF current_setting('cron.database_name', true) IS NOT DISTINCT FROM current_database() THEN
    PERFORM cron.schedule(
    'merchant-daily-billing',
    '0 6 * * *',
    $$ SELECT process_merchant_billing();
  ELSE
    RAISE NOTICE 'pg_cron not operational in % — skipping cron op', current_database();
  END IF;
END $cronguard$; $$
);
