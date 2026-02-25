-- Phase 10: Tip Infrastructure

-- 1. Add Tip Column to Rides
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS tip_amount INTEGER DEFAULT 0;

-- 2. Update Constraint to include 'tip'
-- We drop and recreate to be safe, though this requires exclusive lock.
DO $$ BEGIN
    ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_transaction_type_check;
    ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_transaction_type_check 
        CHECK (transaction_type IN ('topup', 'ride_payment', 'refund', 'bonus', 'driver_payout', 'tip'));
EXCEPTION
    WHEN OTHERS THEN NULL; -- Ignore if table doesn't exist (fresh install)
END $$;

-- 3. Process Tip RPC
CREATE OR REPLACE FUNCTION process_tip(p_ride_id UUID, p_amount INTEGER) RETURNS BOOLEAN AS $$
DECLARE
    v_rider_id UUID;
    v_balance INTEGER;
BEGIN
    -- Get Rider
    SELECT rider_id INTO v_rider_id FROM rides WHERE id = p_ride_id;
    
    IF v_rider_id IS NULL THEN
        RAISE EXCEPTION 'Ride not found';
    END IF;

    -- Check Balance using existing logic or direct query
    SELECT COALESCE(SUM(amount), 0) INTO v_balance 
    FROM wallet_transactions 
    WHERE user_id = v_rider_id AND status = 'completed';
    
    IF v_balance < p_amount THEN
        RETURN FALSE; -- Insufficient Funds
    END IF;
    
    -- Deduct Tip
    INSERT INTO wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
    VALUES (v_rider_id, p_ride_id, -p_amount, 'tip', 'Driver Tip', 'completed');
    
    -- Update Ride
    UPDATE rides SET tip_amount = p_amount WHERE id = p_ride_id;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant Access
GRANT EXECUTE ON FUNCTION process_tip TO authenticated;
GRANT EXECUTE ON FUNCTION process_tip TO service_role;
