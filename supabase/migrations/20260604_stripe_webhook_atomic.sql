-- Migration: Atomic Stripe Webhook Settlement
-- Prevents double-payout on Stripe webhook retry via transaction-level advisory locks.
-- Replaces the 6-step non-atomic REST-call settlement with a single Postgres RPC.

-- Track all processed Stripe events for idempotency
CREATE TABLE IF NOT EXISTS public.processed_stripe_events (
    event_id TEXT PRIMARY KEY,
    processed_at TIMESTAMPTZ DEFAULT NOW(),
    status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILED', 'ROLLED_BACK'))
);

CREATE INDEX IF NOT EXISTS idx_processed_stripe_events_status ON public.processed_stripe_events(status);

-- Atomic settlement: all-or-nothing with advisory lock guarding
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
    v_reserve_cents BIGINT;
    v_net_cents BIGINT;
    v_platform_fee_cents BIGINT;
    v_driver_net_cents BIGINT;
    v_ledger_id BIGINT;
    v_platform_account CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
    -- Acquire transaction-level advisory lock on the Stripe event ID hash.
    -- This lock is automatically released when the transaction commits or rolls back.
    SELECT pg_try_advisory_xact_lock(hashtext(p_event_id)) INTO v_lock_acquired;

    IF NOT v_lock_acquired THEN
        RETURN jsonb_build_object(
            'status', 'CONFLICT',
            'error', 'Settlement for event ' || p_event_id || ' is already being processed by another thread.'
        );
    END IF;

    -- Idempotency check: skip if already successfully processed
    SELECT EXISTS(
        SELECT 1 FROM public.processed_stripe_events
        WHERE event_id = p_event_id AND status = 'SUCCESS'
    ) INTO v_already_processed;

    IF v_already_processed THEN
        RETURN jsonb_build_object('status', 'SKIPPED', 'message', 'Event already processed.');
    END IF;

    -- Compute settlement splits (must match stripe_webhook computeSettlement)
    v_reserve_cents := ROUND(p_gross_cents * 0.015);
    v_net_cents := p_gross_cents - v_reserve_cents;
    v_platform_fee_cents := ROUND(v_net_cents * 0.185);
    v_driver_net_cents := v_net_cents - v_platform_fee_cents;

    -- Step A: Write canonical ledger entry
    INSERT INTO payment_ledger (ride_id, user_id, amount, currency, status, provider, provider_ref, stripe_event_id)
    VALUES (p_ride_id, p_rider_id, p_gross_cents / 100.0, p_currency, 'captured', 'stripe', p_provider_ref, p_event_id)
    RETURNING id INTO v_ledger_id;

    -- Step B: Credit driver wallet (net payout)
    INSERT INTO wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
    VALUES (p_driver_id, p_ride_id, v_driver_net_cents, 'driver_payout', 'Card ride earnings', 'completed');

    -- Step C: Credit platform fee
    INSERT INTO wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
    VALUES (v_platform_account, p_ride_id, v_platform_fee_cents, 'ride_payment', 'Platform commission on card ride', 'completed');

    -- Step D: Credit capital reserve
    INSERT INTO wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
    VALUES (v_platform_account, p_ride_id, v_reserve_cents, 'capital_reserve', '1.5% Capital Reserve (War Chest) on card ride', 'completed');

    -- Step E: Write to capital_reserve_ledger
    INSERT INTO capital_reserve_ledger (ride_id, amount_cents, status, notes)
    VALUES (p_ride_id, v_reserve_cents, 'locked', 'Card ride — reserve locked via Stripe settlement');

    -- Step F: Mark ride as captured with settlement breakdown
    UPDATE rides
    SET payment_status = 'captured',
        driver_payout_cents = v_driver_net_cents,
        reserve_cents = v_reserve_cents,
        platform_fee_cents = v_platform_fee_cents
    WHERE id = p_ride_id;

    -- Mark event as successfully processed (idempotency anchor)
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
    -- Log the failure so we don't silently lose events
    INSERT INTO public.processed_stripe_events (event_id, status)
    VALUES (p_event_id, 'FAILED')
    ON CONFLICT (event_id) DO UPDATE SET status = 'FAILED', processed_at = NOW();

    -- Also write to system_alerts for human review
    INSERT INTO system_alerts (type, severity, title, details)
    VALUES (
        'PAYMENT_ANOMALY', 'CRITICAL',
        'Atomic settlement failed for event ' || p_event_id,
        jsonb_build_object(
            'ride_id', p_ride_id,
            'error', SQLERRM,
            'event_id', p_event_id
        )
    );

    RAISE;
END;
$$;
