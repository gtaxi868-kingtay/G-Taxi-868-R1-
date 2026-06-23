-- ════════════════════════════════════════════════════════════════════════
-- BUSINESS-PLAN REVENUE SPLIT: 82 / 15 / 3
-- ════════════════════════════════════════════════════════════════════════
-- Aligns the settlement engine with the G-TAXI 868 business plan:
--   Driver         82%   (gross − platform − reserve)
--   Platform       15%   PLATFORM_RATE_CENTS = 1500  (÷10000 = 0.15)
--   Growth Reserve  3%   RESERVE_RATE_CENTS  =  300  (÷10000 = 0.03)
--   Loyalty driver: platform rate − 0.03 = 12%  → driver 85%
--
-- This SUPERSEDES the prior model (platform 19%, reserve 1.5% nested inside
-- the platform fee, driver 81%). The reserve is now a THIRD bucket that, with
-- the platform fee, is deducted from gross — so the three buckets sum to gross.
-- Drivers gain (81% → 82%); the platform absorbs the cut (19% → 15%).
--
-- Invariant (both cash/wallet and card paths): platform + reserve + driver = gross
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Pricing config (single source of truth, admin-editable) ────────────
UPDATE public.pricing_config
   SET value_cents = 1500, updated_at = now()
 WHERE key = 'PLATFORM_RATE_CENTS';

INSERT INTO public.pricing_config (key, value_cents, description)
VALUES ('PLATFORM_RATE_CENTS', 1500, 'Platform commission rate (basis points ÷ 10000 = 0.15)')
ON CONFLICT (key) DO UPDATE SET value_cents = EXCLUDED.value_cents, updated_at = now();

INSERT INTO public.pricing_config (key, value_cents, description)
VALUES ('RESERVE_RATE_CENTS', 300, 'Growth/capital reserve rate (basis points ÷ 10000 = 0.03)')
ON CONFLICT (key) DO UPDATE SET value_cents = EXCLUDED.value_cents, updated_at = now();

-- ── 2. Card settlement path — rewrite to 82/15/3, rates from config ───────
CREATE OR REPLACE FUNCTION public.process_driver_settlement_atomic(
    p_event_id TEXT,
    p_ride_id UUID,
    p_driver_id UUID,
    p_rider_id UUID,
    p_gross_cents BIGINT,
    p_currency TEXT,
    p_provider_ref TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_lock_acquired BOOLEAN;
    v_already_processed BOOLEAN;
    v_platform_rate NUMERIC;
    v_reserve_rate NUMERIC;
    v_reserve_cents BIGINT;
    v_platform_fee_cents BIGINT;
    v_driver_net_cents BIGINT;
    v_ledger_id BIGINT;
    v_platform_account CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
    SELECT pg_try_advisory_xact_lock(hashtext(p_event_id)) INTO v_lock_acquired;

    IF NOT v_lock_acquired THEN
        RETURN jsonb_build_object(
            'status', 'CONFLICT',
            'error', 'Settlement for event ' || p_event_id || ' is already being processed by another thread.'
        );
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM public.processed_stripe_events
        WHERE event_id = p_event_id AND status = 'SUCCESS'
    ) INTO v_already_processed;

    IF v_already_processed THEN
        RETURN jsonb_build_object('status', 'SKIPPED', 'message', 'Event already processed.');
    END IF;

    -- Settlement: 82/15/3, rates sourced from pricing_config (admin-editable).
    v_platform_rate := COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'PLATFORM_RATE_CENTS'), 1500) / 10000.0;
    v_reserve_rate  := COALESCE((SELECT value_cents FROM public.pricing_config WHERE key = 'RESERVE_RATE_CENTS'), 300) / 10000.0;
    v_platform_fee_cents := ROUND(p_gross_cents * v_platform_rate);
    v_reserve_cents := ROUND(p_gross_cents * v_reserve_rate);
    v_driver_net_cents := p_gross_cents - v_platform_fee_cents - v_reserve_cents;

    INSERT INTO payment_ledger (ride_id, user_id, amount, currency, status, provider, provider_ref, stripe_event_id)
    VALUES (p_ride_id, p_rider_id, p_gross_cents / 100.0, p_currency, 'captured', 'stripe', p_provider_ref, p_event_id)
    RETURNING id INTO v_ledger_id;

    INSERT INTO wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
    VALUES (p_driver_id, p_ride_id, v_driver_net_cents, 'driver_payout', 'Card ride earnings', 'completed');

    INSERT INTO wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
    VALUES (v_platform_account, p_ride_id, v_platform_fee_cents, 'ride_payment', 'Platform commission on card ride', 'completed');

    INSERT INTO wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
    VALUES (v_platform_account, p_ride_id, v_reserve_cents, 'capital_reserve', '3% Growth Reserve (War Chest) on card ride', 'completed');

    INSERT INTO capital_reserve_ledger (ride_id, amount_cents, status, notes)
    VALUES (p_ride_id, v_reserve_cents, 'locked', 'Card ride — reserve locked via Stripe settlement');

    UPDATE rides
    SET payment_status = 'captured',
        driver_payout_cents = v_driver_net_cents,
        reserve_cents = v_reserve_cents,
        platform_fee_cents = v_platform_fee_cents
    WHERE id = p_ride_id;

    INSERT INTO public.processed_stripe_events (event_id, status)
    VALUES (p_event_id, 'SUCCESS')
    ON CONFLICT (event_id) DO UPDATE SET status = 'SUCCESS', processed_at = NOW();

    RETURN jsonb_build_object(
        'status', 'SUCCESS',
        'ledger_id', v_ledger_id,
        'gross_cents', p_gross_cents,
        'reserve_cents', v_reserve_cents,
        'platform_fee_cents', v_platform_fee_cents,
        'driver_net_cents', v_driver_net_cents
    );

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.processed_stripe_events (event_id, status)
    VALUES (p_event_id, 'FAILED')
    ON CONFLICT (event_id) DO UPDATE SET status = 'FAILED', processed_at = NOW();

    INSERT INTO system_alerts (type, severity, title, details)
    VALUES (
        'PAYMENT_ANOMALY', 'CRITICAL',
        'Atomic settlement failed for event ' || p_event_id,
        jsonb_build_object('ride_id', p_ride_id, 'error', SQLERRM, 'event_id', p_event_id)
    );

    RAISE;
END;
$$;
