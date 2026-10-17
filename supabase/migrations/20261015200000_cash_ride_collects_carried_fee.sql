-- ═══════════════════════════════════════════════════════════════════
-- Cash rides collect a carried-over late-cancel fee (founder decision
-- 2026-10-15: "the fee goes onto their next cash fare instead of locking
-- them out").
--
-- create_ride now lets a cash rider who owes <= TT$50 book, and tags the
-- ride with metadata.carried_fee_cents. The driver collects fare + that fee
-- in cash. On settlement:
--   rider  +fee  debt_settlement  (their negative balance is cleared)
--   driver -fee  folded into the ride's one commission_debt row (they hold
--                that cash; it is owed to G-Taxi, like the platform share)
-- The driver's own pay is unchanged. The amount cleared is capped at what
-- the rider actually still owes at settlement, so a debt paid off some other
-- way in the meantime is never collected twice. Idempotent per ride.
--
-- Everything else in this function is unchanged from the live definition
-- (pg_get_functiondef, 2026-10-15).
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.settle_cash_ride(p_ride_id uuid, p_loyalty_rate_bps integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_ride RECORD; v_driver_uid UUID; v_gross BIGINT; v_split jsonb;
    v_driver_net BIGINT; v_platform_fee BIGINT; v_reserve BIGINT; v_owed BIGINT;
    v_carried BIGINT := 0; v_rider_owes BIGINT;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
    IF v_ride IS NULL THEN RETURN FALSE; END IF;
    IF COALESCE(v_ride.cash_confirmed, false) THEN RETURN TRUE; END IF;

    v_driver_uid := (SELECT user_id FROM public.drivers WHERE id = v_ride.driver_id);
    IF v_driver_uid IS NULL THEN v_driver_uid := v_ride.driver_id; END IF;
    v_gross := COALESCE(v_ride.total_fare_cents, 0);

    IF v_gross > 0 THEN
        v_split := public.compute_ride_split(p_ride_id, v_gross, 0, p_loyalty_rate_bps);
        v_driver_net := (v_split->>'driver_net')::bigint; v_platform_fee := (v_split->>'platform_fee')::bigint; v_reserve := (v_split->>'reserve')::bigint;
        v_owed := v_gross - v_driver_net;
        PERFORM public.record_ride_kickbacks(p_ride_id, v_ride.rider_id, v_gross, v_split);
        IF NOT EXISTS (SELECT 1 FROM public.wallet_transactions WHERE ride_id = p_ride_id AND transaction_type='commission_debt') THEN
            -- Carried-over late-cancel fee, collected in cash with this fare.
            -- Capped at what the rider still owes right now.
            v_carried := COALESCE(NULLIF(v_ride.metadata->>'carried_fee_cents', '')::bigint, 0);
            IF v_carried > 0 THEN
                SELECT GREATEST(-COALESCE(SUM(amount), 0), 0) INTO v_rider_owes
                  FROM public.wallet_transactions WHERE user_id = v_ride.rider_id;
                v_carried := LEAST(v_carried, v_rider_owes);
            END IF;

            -- One commission_debt row per ride (unique per user/ride/type), so
            -- the carried fee is folded into it. check_driver_debt_limit counts
            -- commission_debt, so the driver's TT$300 limit sees it too.
            INSERT INTO public.wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
            VALUES (v_driver_uid, p_ride_id, -(v_owed + v_carried), 'commission_debt',
                    CASE WHEN v_carried > 0
                         THEN format('Cash ride — platform commission + kickbacks owed, plus %s cents cancellation fee collected for G-Taxi', v_carried)
                         ELSE 'Cash ride — platform commission + kickbacks owed' END,
                    'pending');

            IF v_carried > 0 THEN
                INSERT INTO public.wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
                VALUES (v_ride.rider_id, p_ride_id, v_carried, 'debt_settlement',
                        'Earlier cancellation fee paid in cash on this ride', 'completed');
            END IF;
        END IF;

        UPDATE public.rides SET cash_confirmed=TRUE, payment_status='confirmed', updated_at=NOW(),
            driver_payout_cents=v_driver_net, platform_fee_cents=v_platform_fee, reserve_cents=v_reserve WHERE id=p_ride_id;
    ELSE
        UPDATE public.rides SET cash_confirmed=TRUE, payment_status='confirmed', updated_at=NOW() WHERE id=p_ride_id;
    END IF;
    RETURN TRUE;
END;
$function$;
