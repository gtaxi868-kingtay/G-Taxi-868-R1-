-- Phase 3 monorepo audit (2026-08-16): apps/rider/src/services/api.ts:582
-- calls RPC process_tip, which had ZERO EXECUTE grant to authenticated --
-- confirmed live -- so every tip attempt failed silently while the
-- rating itself (a separate call) still succeeded. Rider believes they
-- tipped and didn't.
--
-- Before granting, read the full body: two more real bugs found.
-- (1) No ownership check -- v_rider_id was read from rides.rider_id, not
--     compared to auth.uid(), so once granted ANY authenticated user
--     could tip on ANY ride, draining a stranger's wallet balance.
-- (2) The tip amount was deducted from the rider and written to
--     rides.tip_amount, but NEVER credited to the driver anywhere --
--     grepped complete_ride and the whole rider app for tip_amount,
--     zero readers. Drivers have never received a single tip, ever,
--     even on the rare occasion this RPC succeeded via a direct API
--     call bypassing the missing grant.
--
-- Fixed: added the ownership check (matches the ownership-check pattern
-- already applied session-wide to wallet-debit functions), and added
-- the missing driver credit via drivers.user_id (rides.driver_id is
-- drivers.id, not an auth id -- the recurring identity gotcha this
-- session, see project_rides_driver_id_identity.md).
--
-- Live-verified in a rolled-back transaction using real existing rider
-- and driver rows: owner tip succeeds, rider debit AND driver credit
-- both post correctly with matching ride_id, and an unrelated real
-- account attempting to tip on the same ride is correctly rejected
-- ("Unauthorized: not your ride"). No test data persisted.
CREATE OR REPLACE FUNCTION public.process_tip(p_ride_id uuid, p_amount integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_rider_id UUID;
    v_driver_id UUID;
    v_driver_user_id UUID;
    v_balance INTEGER;
BEGIN
    SELECT rider_id, driver_id INTO v_rider_id, v_driver_id FROM rides WHERE id = p_ride_id;

    IF v_rider_id IS NULL THEN
        RAISE EXCEPTION 'Ride not found';
    END IF;

    IF v_rider_id != auth.uid() THEN
        RAISE EXCEPTION 'Unauthorized: not your ride';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Invalid tip amount';
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM wallet_transactions
    WHERE user_id = v_rider_id AND status = 'completed';

    IF v_balance < p_amount THEN
        RETURN FALSE; -- Insufficient Funds
    END IF;

    INSERT INTO wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
    VALUES (v_rider_id, p_ride_id, -p_amount, 'tip', 'Driver Tip', 'completed');

    IF v_driver_id IS NOT NULL THEN
        SELECT user_id INTO v_driver_user_id FROM drivers WHERE id = v_driver_id;
        IF v_driver_user_id IS NOT NULL THEN
            INSERT INTO wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
            VALUES (v_driver_user_id, p_ride_id, p_amount, 'tip', 'Rider Tip Received', 'completed');
        END IF;
    END IF;

    UPDATE rides SET tip_amount = p_amount WHERE id = p_ride_id;

    RETURN TRUE;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.process_tip(uuid, integer) TO authenticated;
