-- G-TAXI: Order payment columns + Amadeus booking + auto-book toggle
-- ============================================================
-- 1. Adds payment tracking to orders table (card + cash-on-delivery)
-- 2. Adds Amadeus-required fields to passenger_details
-- 3. Adds auto_book_enabled toggle to escape_packages
-- 4. Creates process_cash_delivery_settlement RPC
-- 5. Creates admin_escape_action RPC (replace edge function, avoid 60+ cap)

-- ── 1. ORDER PAYMENT COLUMNS ─────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT NULL
  CHECK (payment_method IN ('card', 'cash', 'wallet'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid'
  CHECK (payment_status IN ('unpaid', 'pending', 'paid', 'cash_on_delivery'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cash_collected BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cash_collected_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS merchant_payout_status TEXT DEFAULT 'pending'
  CHECK (merchant_payout_status IN ('pending', 'scheduled', 'paid'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS merchant_paid_cents INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS merchant_paid_at TIMESTAMPTZ;

-- ── 2. PASSENGER DETAILS — AMADEUS FIELDS ────────────────────────
ALTER TABLE passenger_details ADD COLUMN IF NOT EXISTS gender TEXT DEFAULT NULL
  CHECK (gender IN ('MALE', 'FEMALE', 'OTHER'));
ALTER TABLE passenger_details ADD COLUMN IF NOT EXISTS phone_country_code TEXT DEFAULT NULL;
ALTER TABLE passenger_details ADD COLUMN IF NOT EXISTS phone_number TEXT DEFAULT NULL;
ALTER TABLE passenger_details ADD COLUMN IF NOT EXISTS email TEXT DEFAULT NULL;
ALTER TABLE passenger_details ADD COLUMN IF NOT EXISTS passport_issuance_date TEXT DEFAULT NULL;
ALTER TABLE passenger_details ADD COLUMN IF NOT EXISTS passport_issuance_location TEXT DEFAULT NULL;
ALTER TABLE passenger_details ADD COLUMN IF NOT EXISTS passport_issuance_country TEXT DEFAULT NULL;
ALTER TABLE passenger_details ADD COLUMN IF NOT EXISTS birth_place TEXT DEFAULT NULL;

-- ── 3. ESCAPE PACKAGES — AUTO-BOOK TOGGLE ────────────────────────
ALTER TABLE escape_packages ADD COLUMN IF NOT EXISTS auto_book_enabled BOOLEAN DEFAULT false;
ALTER TABLE escape_packages ADD COLUMN IF NOT EXISTS amadeus_pnr TEXT DEFAULT NULL;
ALTER TABLE escape_packages ADD COLUMN IF NOT EXISTS amadeus_booked_at TIMESTAMPTZ;

-- ── 4. PROCESS CASH DELIVERY SETTLEMENT RPC ──────────────────────
-- Called when driver marks cash collected. Driver keeps cash as partial
-- commission settlement; platform credits merchant wallet from reserves.
CREATE OR REPLACE FUNCTION process_cash_delivery_settlement(
    p_order_id UUID,
    p_driver_user_id UUID,
    p_merchant_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order RECORD;
    v_merchant_owner_id UUID;
    v_merchant_cut_cents INTEGER;
    v_platform_rate NUMERIC := 0.19;
BEGIN
    -- Lock the order row
    SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order not found');
    END IF;

    IF v_order.payment_status != 'cash_on_delivery' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order is not cash-on-delivery');
    END IF;

    IF v_order.merchant_payout_status = 'paid' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Already settled');
    END IF;

    -- Merchant gets 81% of total (same split as rides)
    v_merchant_cut_cents := round(v_order.total_cents * (1 - v_platform_rate));

    -- Get merchant owner user_id
    SELECT created_by INTO v_merchant_owner_id FROM merchants WHERE id = p_merchant_id;

    IF v_merchant_owner_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Merchant has no owner');
    END IF;

    -- Credit merchant wallet
    INSERT INTO wallet_transactions (user_id, order_id, amount, transaction_type, description, status)
    VALUES (v_merchant_owner_id, p_order_id, v_merchant_cut_cents, 'merchant_commission',
            'Cash delivery settlement — order ' || p_order_id::text, 'completed');

    INSERT INTO wallets (user_id, balance_cents)
    VALUES (v_merchant_owner_id, v_merchant_cut_cents)
    ON CONFLICT (user_id)
    DO UPDATE SET balance_cents = wallets.balance_cents + v_merchant_cut_cents;

    -- Mark order settled
    UPDATE orders SET
        merchant_payout_status = 'paid',
        merchant_paid_cents = v_merchant_cut_cents,
        merchant_paid_at = now(),
        cash_collected = true,
        cash_collected_at = now()
    WHERE id = p_order_id;

    -- Log to platform revenue
    INSERT INTO platform_revenue_logs (order_id, merchant_id, gross_cents, platform_fee_cents, merchant_split_cents)
    VALUES (p_order_id, p_merchant_id, v_order.total_cents,
            v_order.total_cents - v_merchant_cut_cents, v_merchant_cut_cents);

    -- Deduct driver wallet (driver keeps cash, so balance decreases by commission)
    INSERT INTO wallet_transactions (user_id, order_id, amount, transaction_type, description, status)
    VALUES (p_driver_user_id, p_order_id, -(v_order.total_cents - v_merchant_cut_cents), 'commission_fee',
            'Platform fee on cash delivery — driver collected ' || (v_order.total_cents / 100)::text || ' TTD cash', 'completed');

    RETURN jsonb_build_object(
        'success', true,
        'merchant_credited_cents', v_merchant_cut_cents,
        'platform_fee_cents', v_order.total_cents - v_merchant_cut_cents,
        'merchant_owner', v_merchant_owner_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION process_cash_delivery_settlement(UUID, UUID, UUID) TO service_role;

-- ── 5. ADMIN ESCAPE ACTION RPC ────────────────────────────────────
-- Replaces admin_confirm_escape_seats edge function to avoid 60+ function cap.
-- Actions: confirm, delay, refund_all
CREATE OR REPLACE FUNCTION admin_escape_action(
    p_package_id UUID,
    p_action TEXT,
    p_booking_ref TEXT DEFAULT NULL,
    p_message TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_pkg RECORD;
    v_participants INT;
    v_refunded INT := 0;
    v_rider_record RECORD;
BEGIN
    -- Validate action
    IF p_action NOT IN ('confirm', 'delay', 'refund_all') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid action. Use confirm, delay, or refund_all.');
    END IF;

    SELECT * INTO v_pkg FROM escape_packages WHERE id = p_package_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Package not found');
    END IF;

    -- ── CONFIRM ──────────────────────────────────────────────────
    IF p_action = 'confirm' THEN
        -- Update all confirmed/payment_pending participants to passport_pending
        UPDATE escape_group_participants
        SET status = 'passport_pending', confirmed_at = COALESCE(confirmed_at, now())
        WHERE package_id = p_package_id
          AND status IN ('confirmed', 'payment_pending');

        GET DIAGNOSTICS v_participants = ROW_COUNT;

        -- Store booking reference if provided
        IF p_booking_ref IS NOT NULL THEN
            UPDATE escape_packages SET charter_reference = p_booking_ref WHERE id = p_package_id;
        END IF;

        -- Log alert
        INSERT INTO group_booking_alerts (package_id, alert_type, message)
        VALUES (p_package_id, 'reschedule_accepted',
                'Admin confirmed ' || v_participants || ' participants. Ref: ' || COALESCE(p_booking_ref, 'N/A'));

        RETURN jsonb_build_object(
            'success', true,
            'participants_confirmed', v_participants,
            'package', v_pkg.package_name,
            'booking_reference', p_booking_ref
        );
    END IF;

    -- ── DELAY ────────────────────────────────────────────────────
    IF p_action = 'delay' THEN
        INSERT INTO group_booking_alerts (package_id, alert_type, message)
        VALUES (p_package_id, 'delay', COALESCE(p_message, 'Trip delayed by admin'));

        RETURN jsonb_build_object(
            'success', true,
            'message', 'Delay alert broadcast',
            'detail', p_message
        );
    END IF;

    -- ── REFUND ALL ───────────────────────────────────────────────
    IF p_action = 'refund_all' THEN
        FOR v_rider_record IN
            SELECT id, rider_id, paid_cents
            FROM escape_group_participants
            WHERE package_id = p_package_id
              AND status IN ('confirmed', 'passport_pending', 'travel_ready', 'payment_pending', 'intent_pending')
        LOOP
            IF v_rider_record.paid_cents > 0 THEN
                PERFORM credit_wallet(
                    v_rider_record.rider_id,
                    v_rider_record.paid_cents,
                    'travel_package_refund',
                    'Full refund — trip cancelled by admin',
                    v_rider_record.id
                );
            END IF;

            UPDATE escape_group_participants
            SET status = CASE WHEN v_rider_record.paid_cents > 0 THEN 'refunded' ELSE 'cancelled' END
            WHERE id = v_rider_record.id;

            v_refunded := v_refunded + 1;
        END LOOP;

        INSERT INTO group_booking_alerts (package_id, alert_type, message)
        VALUES (p_package_id, 'refund_completed',
                'Admin refunded ' || v_refunded || ' participants for cancelled trip');

        RETURN jsonb_build_object('success', true, 'refunded', v_refunded);
    END IF;

    RETURN jsonb_build_object('success', false, 'error', 'Unhandled action');
END;
$$;

GRANT EXECUTE ON FUNCTION admin_escape_action(UUID, TEXT, TEXT, TEXT) TO service_role;
