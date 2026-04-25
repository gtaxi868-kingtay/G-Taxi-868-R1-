-- SECURE PAYMENT RPC (Phase 4 & 5)
-- Goal: Atomic Payment Capture + Idempotency + Status Update

BEGIN;
CREATE OR REPLACE FUNCTION process_wallet_payment(p_ride_id UUID, p_amount INTEGER) RETURNS BOOLEAN AS $$
DECLARE
    v_rider_id UUID;
    v_balance INTEGER;
    v_payment_status public.payment_status_enum;
BEGIN
    -- 1. Lock Ride & Check Idempotency
    SELECT rider_id, payment_status INTO v_rider_id, v_payment_status
    FROM rides WHERE id = p_ride_id FOR UPDATE;
    
    -- If already captured, treat as success (Idempotent)
    IF v_payment_status = 'captured' THEN
        RETURN TRUE;
    END IF;
    
    -- 2. Check Balance
    v_balance := get_wallet_balance(v_rider_id);
    IF v_balance < p_amount THEN
        RETURN FALSE; -- Insufficient Funds
    END IF;
    
    -- 3. Deduct (Insert Transaction)
    INSERT INTO wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
    VALUES (v_rider_id, p_ride_id, -p_amount, 'ride_payment', 'Payment for Ride', 'completed');
    
    -- 4. Update Ride Payment Status
    UPDATE rides 
    SET payment_status = 'captured', 
        updated_at = now() 
    WHERE id = p_ride_id;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
COMMIT;
