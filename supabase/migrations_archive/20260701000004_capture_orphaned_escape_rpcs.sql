-- Recovery hygiene: capture two G-Escape RPCs that exist in the live DB
-- (project ffbbuafgeypvkpcuvdnv) but were never committed to a migration file.
-- Both are load-bearing: called by the deployed `travel` (book_escape) and
-- `wipay_webhook` (gescape callback) edge functions. Without them, a
-- rebuild-from-migrations would silently break escape booking + rollback.
--
-- Bodies reproduced verbatim from pg_get_functiondef() on 2026-07-01.
-- CREATE OR REPLACE => applying this against prod is an idempotent no-op.

-- ── release_single_reservation: error-path rollback for a held reservation ──
CREATE OR REPLACE FUNCTION public.release_single_reservation(p_reservation_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_rec RECORD;
BEGIN
    SELECT id, flight_block_id, escape_package_id, guest_count INTO v_rec
    FROM public.package_reservations
    WHERE id = p_reservation_id AND status = 'ACTIVE_HOLD'
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN RETURN FALSE; END IF;

    UPDATE public.flight_blocks
    SET allocated_seats = GREATEST(0, allocated_seats - v_rec.guest_count), updated_at = now()
    WHERE id = v_rec.flight_block_id;

    UPDATE public.escape_packages
    SET allocated_guests = GREATEST(0, allocated_guests - v_rec.guest_count), updated_at = now()
    WHERE id = v_rec.escape_package_id;

    UPDATE public.package_reservations SET status = 'RELEASED', updated_at = now() WHERE id = v_rec.id;
    RETURN TRUE;
END;
$function$;

-- ── capture_escape_wallet_payment: wallet-path capture with FOR UPDATE lock ──
CREATE OR REPLACE FUNCTION public.capture_escape_wallet_payment(p_reservation_id uuid, p_rider_id uuid)
 RETURNS TABLE(success boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_total_cents    INTEGER;
    v_wallet_id      UUID;
    v_wallet_balance INTEGER;
BEGIN
    -- Lock reservation
    SELECT total_price_cents INTO v_total_cents
    FROM public.package_reservations
    WHERE id = p_reservation_id AND rider_id = p_rider_id AND status = 'ACTIVE_HOLD'
    FOR UPDATE;

    IF NOT FOUND THEN
        success := FALSE; message := 'Reservation not found or not in ACTIVE_HOLD status.';
        RETURN NEXT; RETURN;
    END IF;

    -- Lock wallet
    SELECT id, balance_cents INTO v_wallet_id, v_wallet_balance
    FROM public.wallets
    WHERE user_id = p_rider_id
    FOR UPDATE;

    IF NOT FOUND OR v_wallet_balance < v_total_cents THEN
        success := FALSE;
        message := 'Insufficient wallet balance. Need TTD ' || ROUND(v_total_cents::NUMERIC / 100, 2)::TEXT;
        RETURN NEXT; RETURN;
    END IF;

    -- Deduct
    UPDATE public.wallets
    SET balance_cents = balance_cents - v_total_cents,
        updated_at = now()
    WHERE id = v_wallet_id;

    -- Log
    INSERT INTO public.wallet_transactions (
        user_id, amount_cents, transaction_type, description, metadata
    ) VALUES (
        p_rider_id, -v_total_cents, 'travel_package_payment',
        'G-Escape booking — wallet capture',
        jsonb_build_object('reservation_id', p_reservation_id, 'source', 'g_escape')
    );

    -- Advance reservation state
    UPDATE public.package_reservations
    SET status = 'CAPTURED', captured_at = now(), updated_at = now()
    WHERE id = p_reservation_id;

    success := TRUE; message := 'Payment captured.';
    RETURN NEXT;
END;
$function$;
