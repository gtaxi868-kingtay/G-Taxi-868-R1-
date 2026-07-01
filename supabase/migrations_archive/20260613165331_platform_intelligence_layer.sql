-- =============================================================================
-- PLATFORM INTELLIGENCE LAYER
-- 1. Fix credit_merchant_commission to update wallet balance
-- 2. agent_decision_log — AI decisions with reasoning
-- 3. dispatch_queue — unmatched orders pending driver assignment
-- 4. merchant_wallet_balance view — spendable commission balance visible to merchants
-- 5. Tool RPCs for the AI agent
-- 6. Auto-surge trigger on demand_patterns
-- 7. pg_cron: platform_intelligence every 15 min
-- =============================================================================

-- ── Fix wallet_transactions constraint to include merchant_commission ─────────
ALTER TABLE public.wallet_transactions
    DROP CONSTRAINT IF EXISTS wallet_transactions_transaction_type_check;

ALTER TABLE public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_transaction_type_check
    CHECK (transaction_type IN (
        'topup', 'ride_payment', 'refund', 'bonus',
        'driver_payout', 'tip', 'commission_fee',
        'cancellation_fee', 'leakage_fine', 'debt_recovery',
        'payout', 'debt_repayment',
        'lease_deduction', 'lease_income',
        'capital_reserve',
        'merchant_commission',
        'travel_package_payment', 'travel_package_refund',
        'scout_referral_payout', 'referral_bonus'
    ));

-- ── Fix credit_merchant_commission: also update wallets.balance_cents ─────────
CREATE OR REPLACE FUNCTION credit_merchant_commission(
    p_merchant_id   UUID,
    p_ride_id       UUID,
    p_amount_cents  INTEGER
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
            'Vendor kiosk commission', 'completed');

    INSERT INTO wallets (user_id, balance_cents)
    VALUES (v_user_id, p_amount_cents)
    ON CONFLICT (user_id)
    DO UPDATE SET balance_cents = wallets.balance_cents + p_amount_cents;
END;
$$;

GRANT EXECUTE ON FUNCTION credit_merchant_commission(UUID, UUID, INTEGER) TO service_role;

-- ── agent_decision_log ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_decision_log (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id        UUID NOT NULL DEFAULT gen_random_uuid(),
    decision_type TEXT NOT NULL CHECK (decision_type IN (
        'surge_activated', 'surge_deactivated',
        'order_dispatched', 'package_created',
        'demand_alert', 'no_action'
    )),
    reasoning     TEXT NOT NULL,
    tool_used     TEXT,
    payload       JSONB DEFAULT '{}',
    outcome       TEXT,
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_decision_log_created ON agent_decision_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_decision_log_type ON agent_decision_log(decision_type);

-- ── dispatch_queue ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_queue (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    delivery_method TEXT NOT NULL,
    pickup_lat     DOUBLE PRECISION,
    pickup_lng     DOUBLE PRECISION,
    attempts       INTEGER NOT NULL DEFAULT 0,
    last_attempted TIMESTAMPTZ,
    status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'dispatched', 'failed', 'cancelled')),
    ride_id        UUID REFERENCES rides(id),
    created_at     TIMESTAMPTZ DEFAULT now(),
    UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS idx_dispatch_queue_pending ON dispatch_queue(created_at)
    WHERE status = 'pending';

-- ── merchant_wallet_balance view ──────────────────────────────────────────────
CREATE OR REPLACE VIEW merchant_wallet_balance AS
SELECT
    m.id                                                         AS merchant_id,
    m.business_name,
    w.balance_cents,
    COUNT(wt.id)                                                 AS transaction_count,
    COALESCE(SUM(wt.amount) FILTER (WHERE wt.transaction_type = 'merchant_commission'), 0)
                                                                 AS total_commission_earned_cents,
    MAX(wt.created_at)                                           AS last_commission_at
FROM merchants m
JOIN auth.users au ON au.id = m.created_by
LEFT JOIN wallets w ON w.user_id = m.created_by
LEFT JOIN wallet_transactions wt
    ON wt.user_id = m.created_by
    AND wt.transaction_type = 'merchant_commission'
GROUP BY m.id, m.business_name, w.balance_cents;

-- ── Tool RPC: get_demand_hotspots (AI agent reads this) ───────────────────────
CREATE OR REPLACE FUNCTION get_demand_hotspots(p_min_score NUMERIC DEFAULT 1.4)
RETURNS TABLE (
    area_hash       TEXT,
    demand_score    NUMERIC,
    active_drivers  INTEGER,
    actual_demand   INTEGER,
    day_of_week     INTEGER,
    hour_of_day     INTEGER
)
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT area_hash, demand_score, active_drivers, actual_demand, day_of_week, hour_of_day
    FROM demand_patterns
    WHERE demand_score >= p_min_score
      AND day_of_week = EXTRACT(DOW FROM now())::INTEGER
      AND hour_of_day = EXTRACT(HOUR FROM now())::INTEGER
    ORDER BY demand_score DESC
    LIMIT 20;
$$;

GRANT EXECUTE ON FUNCTION get_demand_hotspots(NUMERIC) TO service_role;

-- ── Tool RPC: get_order_dispatch_queue ────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_order_dispatch_queue()
RETURNS TABLE (
    order_id        UUID,
    merchant_name   TEXT,
    delivery_method TEXT,
    status          TEXT,
    created_at      TIMESTAMPTZ,
    attempts        INTEGER
)
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT dq.order_id, m.business_name, dq.delivery_method, dq.status, dq.created_at, dq.attempts
    FROM dispatch_queue dq
    JOIN orders o ON o.id = dq.order_id
    JOIN merchants m ON m.id = o.merchant_id
    WHERE dq.status = 'pending'
      AND dq.attempts < 5
    ORDER BY dq.created_at ASC
    LIMIT 50;
$$;

GRANT EXECUTE ON FUNCTION get_order_dispatch_queue() TO service_role;

-- ── Tool RPC: get_package_opportunities ───────────────────────────────────────
CREATE OR REPLACE FUNCTION get_package_opportunities()
RETURNS TABLE (
    flight_id           UUID,
    flight_number       TEXT,
    destination_code    TEXT,
    departure_at        TIMESTAMPTZ,
    seats_available     INTEGER,
    wholesale_price     INTEGER,
    retail_price        INTEGER,
    margin_per_seat     INTEGER
)
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT
        fi.id,
        fi.flight_number,
        fi.destination_code,
        fi.departure_at,
        fi.seats_total - fi.seats_reserved AS seats_available,
        fi.wholesale_price_cents,
        fi.retail_price_cents,
        fi.retail_price_cents - fi.wholesale_price_cents AS margin_per_seat
    FROM flight_inventory fi
    WHERE fi.status = 'available'
      AND fi.departure_at > now() + INTERVAL '3 days'
      AND fi.seats_total - fi.seats_reserved >= 5
    ORDER BY fi.departure_at ASC
    LIMIT 10;
$$;

GRANT EXECUTE ON FUNCTION get_package_opportunities() TO service_role;

-- ── Auto-surge trigger on demand_patterns ─────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_auto_surge_from_demand()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_zone_id UUID;
BEGIN
    -- Only act when demand_score crosses threshold
    IF NEW.demand_score < 1.4 THEN RETURN NEW; END IF;

    -- Mark area needs surge — insert into agent_decision_log
    -- Actual pricing_zones update happens via platform_intelligence edge function
    INSERT INTO agent_decision_log (decision_type, reasoning, tool_used, payload)
    VALUES (
        'demand_alert',
        format('Area %s has demand_score %.2f (drivers: %s, demand: %s) at hour %s',
            NEW.area_hash, NEW.demand_score, NEW.active_drivers, NEW.actual_demand, NEW.hour_of_day),
        'demand_patterns_trigger',
        jsonb_build_object(
            'area_hash', NEW.area_hash,
            'demand_score', NEW.demand_score,
            'active_drivers', NEW.active_drivers,
            'actual_demand', NEW.actual_demand,
            'hour', NEW.hour_of_day,
            'dow', NEW.day_of_week
        )
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_surge_from_demand ON demand_patterns;
CREATE TRIGGER trg_auto_surge_from_demand
    AFTER INSERT OR UPDATE OF demand_score ON demand_patterns
    FOR EACH ROW
    EXECUTE FUNCTION trigger_auto_surge_from_demand();

-- ── Auto-enqueue orders needing dispatch ──────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_enqueue_order_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Only courier/laundry orders need driver dispatch
    IF NEW.delivery_method NOT IN ('courier', 'laundry_pickup') THEN RETURN NEW; END IF;
    IF NEW.status != 'pending' THEN RETURN NEW; END IF;

    INSERT INTO dispatch_queue (order_id, delivery_method, status)
    VALUES (NEW.id, NEW.delivery_method, 'pending')
    ON CONFLICT (order_id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_order_dispatch ON orders;
CREATE TRIGGER trg_enqueue_order_dispatch
    AFTER INSERT ON orders
    FOR EACH ROW
    EXECUTE FUNCTION trigger_enqueue_order_dispatch();

-- ── pg_cron: run platform_intelligence every 15 min ─────────────────────────
-- Requires pg_cron extension. Will silently fail if not enabled.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'platform-intelligence-15min';
        PERFORM cron.schedule(
            'platform-intelligence-15min',
            '*/15 * * * *',
            $$
            SELECT net.http_post(
                url := current_setting('app.supabase_url') || '/functions/v1/platform_intelligence',
                headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'Authorization', 'Bearer ' || current_setting('app.service_role_key')
                ),
                body := '{}'::jsonb
            )
            $$
        );
    END IF;
END;
$$;
