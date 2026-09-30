-- ═══════════════════════════════════════════════════════════════════════════
-- Fix merchant earnings read-path — 2026-09-29
--
-- get_merchant_earnings (backing apps/merchant/src/pages/MerchantFinancials.tsx)
-- read from revenue_splits, filtered to status='settled'. revenue_splits is
-- written by create_ride at RIDE-REQUEST time; nothing anywhere ever flips
-- a row's status to 'settled'. The real node-commission accrual happens at
-- ride SETTLEMENT time, via record_ride_kickbacks (called from complete_ride
-- and process_wallet_payment_hardened), which writes to a DIFFERENT table:
-- vendor_commissions. Two disconnected tables, same failure shape as the
-- G-Escape booking-system split already logged in this repo's history.
--
-- Confirmed live: both tables are empty today (0 completed rides ever), so
-- this has never visibly fired -- it would have shown the first real
-- merchant $0.00 on their first genuine commission day.
--
-- Scope: read-path only. vendor_commissions has no payout mechanism yet
-- either (every row is inserted with status='pending' and nothing ever
-- flips it to 'paid') -- that's a separate, future build, same shape as the
-- commander-payout gap. This migration does not add one; it counts
-- 'pending' and 'paid' (excluding 'cancelled') because a 'pending' row IS a
-- genuinely accrued commission under the current system, just not yet
-- disbursed. No money movement, no new writes, no new tables.
--
-- Dry-run verified in two rolled-back transactions against a synthetic
-- vendor_commissions row (real merchant, real ride FK): the old query
-- returned total_cents=0 with the row present; the new query correctly
-- returned total_cents=250, settled_count=1.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_merchant_earnings(p_merchant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_merchant uuid;
    v_total_cents bigint;
    v_count bigint;
BEGIN
    -- Resolve the caller's merchant from the JWT, not from the argument.
    SELECT merchant_id INTO v_caller_merchant
    FROM profiles
    WHERE id = auth.uid();

    IF v_caller_merchant IS NULL OR v_caller_merchant <> p_merchant_id THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    -- Real accrual lives in vendor_commissions (written by
    -- record_ride_kickbacks at ride settlement), keyed directly by
    -- merchant_id -- no kiosk_nodes join needed, unlike the old
    -- revenue_splits query.
    SELECT COALESCE(SUM(vc.commission_cents), 0)::bigint,
           COUNT(*)::bigint
    INTO v_total_cents, v_count
    FROM vendor_commissions vc
    WHERE vc.merchant_id = p_merchant_id
      AND vc.status IN ('pending', 'paid');

    RETURN jsonb_build_object(
        'total_cents', v_total_cents,
        'settled_count', v_count
    );
END;
$function$;
