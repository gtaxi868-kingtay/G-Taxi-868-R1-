-- ═══════════════════════════════════════════════════════════════════
-- G-ESCAPE MONEY-PATH BUGS FOUND BY GAP-HUNTING SWEEP (2026-07-16)
--
-- Owner explicitly asked for a sweep beyond tonight's ride-settlement
-- fixes ("I noted gaps you left"). Applied the same audit method to
-- G-Escape's wallet payment functions. Found three real bugs, all
-- verified live before applying:
--
-- 1. charge_escape_participant_wallet credited the "platform fee"
--    portion to p_rider_id — the SAME rider who just paid — instead of
--    the platform sentinel account. Copy-paste bug: both INSERTs used
--    p_rider_id. The platform has never collected a fee on any group
--    escape payment; the rider was effectively undercharged by the fee
--    amount (paid amount, then had the fee refunded to themselves).
--    Verified live: on a $200 charge, the rider now correctly nets -$200
--    (was previously -$163.55, i.e. the fee silently came back to them)
--    and the platform genuinely receives 3645 cents (18.5% of the
--    post-reserve amount).
-- 2. Same function computed the 1.5% reserve cut but never recorded it
--    anywhere. Now posted via post_reserve_contribution with
--    source_type 'escape_margin' — 'escape' alone is not an allowed
--    value on capital_reserve_ledger's own CHECK constraint, caught by
--    dry-run before this shipped.
-- 3. capture_escape_wallet_payment inserted wallet_transactions.amount_cents
--    and .metadata — neither column exists on that table (real columns
--    are amount, reference_id). This function has never successfully
--    captured a single G-Escape wallet payment. Also read the stale
--    wallets.balance_cents cache instead of live wallet_transactions
--    sum — same systemic issue already fixed tonight in
--    get_wallet_balance / process_merchant_billing.
--
-- 'escape_group_payment' and 'escape_platform_fee' added to
-- wallet_transactions_transaction_type_check — neither was previously
-- allowed, so the original (buggy) insert would have crashed on this
-- constraint even before reaching the account-routing bug.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.wallet_transactions DROP CONSTRAINT wallet_transactions_transaction_type_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_transaction_type_check
  CHECK (transaction_type = ANY (ARRAY[
    'topup','ride_payment','refund','bonus','driver_payout','tip','commission_fee',
    'cancellation_fee','leakage_fine','debt_recovery','payout','debt_repayment',
    'lease_deduction','lease_income','capital_reserve','merchant_commission',
    'travel_package_payment','travel_package_refund','scout_referral_payout',
    'referral_bonus','merchant_subscription','merchant_purchase','delivery_payout',
    'delivery_fee_platform_share','commission_debt','debt_settlement',
    'escape_group_payment','escape_platform_fee'
  ]));

CREATE OR REPLACE FUNCTION public.charge_escape_participant_wallet(p_rider_id uuid, p_amount_cents integer, p_package_name text, p_reference_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_wallet_balance INTEGER;
    v_reserve INTEGER;
    v_platform INTEGER;
    v_idempotent TEXT;
    v_platform_account CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
    v_idempotent := 'escape_' || p_reference_id::text;
    v_reserve := ROUND(p_amount_cents * 0.015);
    v_platform := ROUND((p_amount_cents - v_reserve) * 0.185);

    SELECT COALESCE(SUM(amount), 0) INTO v_wallet_balance
    FROM public.wallet_transactions WHERE user_id = p_rider_id;

    IF v_wallet_balance < p_amount_cents THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient wallet balance');
    END IF;

    INSERT INTO public.wallet_transactions (user_id, amount, transaction_type, description, status, reference_id)
    VALUES (p_rider_id, -p_amount_cents, 'escape_group_payment',
            'Escape group: ' || p_package_name, 'completed', v_idempotent);

    INSERT INTO public.wallet_transactions (user_id, amount, transaction_type, description, status, reference_id)
    VALUES (v_platform_account, v_platform, 'escape_platform_fee',
            'Platform fee: ' || p_package_name, 'completed', v_idempotent || '_fee');

    IF v_reserve > 0 THEN
        PERFORM public.post_reserve_contribution(p_reference_id, v_reserve, 'escape_margin');
    END IF;

    RETURN jsonb_build_object('success', true, 'amount_cents', p_amount_cents, 'platform_cents', v_platform, 'reserve_cents', v_reserve);
END;
$function$;

CREATE OR REPLACE FUNCTION public.capture_escape_wallet_payment(p_reservation_id uuid, p_rider_id uuid)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_total_cents    INTEGER;
    v_wallet_balance INTEGER;
BEGIN
    SELECT total_price_cents INTO v_total_cents
    FROM public.package_reservations
    WHERE id = p_reservation_id AND rider_id = p_rider_id AND status = 'ACTIVE_HOLD'
    FOR UPDATE;

    IF NOT FOUND THEN
        success := FALSE; message := 'Reservation not found or not in ACTIVE_HOLD status.';
        RETURN NEXT; RETURN;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_wallet_balance
    FROM public.wallet_transactions WHERE user_id = p_rider_id;

    IF v_wallet_balance < v_total_cents THEN
        success := FALSE;
        message := 'Insufficient wallet balance. Need TTD ' || ROUND(v_total_cents::NUMERIC / 100, 2)::TEXT;
        RETURN NEXT; RETURN;
    END IF;

    INSERT INTO public.wallet_transactions (
        user_id, amount, transaction_type, description, status, reference_id
    ) VALUES (
        p_rider_id, -v_total_cents, 'travel_package_payment',
        'G-Escape booking — wallet capture', 'completed', p_reservation_id::text
    );

    UPDATE public.package_reservations
    SET status = 'CAPTURED', captured_at = now(), updated_at = now()
    WHERE id = p_reservation_id;

    success := TRUE; message := 'Payment captured.';
    RETURN NEXT;
END;
$function$;

NOTIFY pgrst, 'reload schema';
