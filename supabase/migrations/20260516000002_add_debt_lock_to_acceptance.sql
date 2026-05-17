-- ADD DEBT LOCK TO RIDE ACCEPTANCE
-- For Phase 1: Operational Integrity

CREATE OR REPLACE FUNCTION accept_ride_offer(p_offer_id UUID) RETURNS BOOLEAN AS $$
DECLARE
    v_offer RECORD;
    v_ride_id UUID;
    v_driver_user_id UUID;
    v_balance INTEGER;
BEGIN
    -- Get the offer details
    SELECT * INTO v_offer FROM ride_offers WHERE id = p_offer_id;
    IF v_offer IS NULL OR v_offer.status != 'pending' THEN RETURN FALSE; END IF;
    
    v_ride_id := v_offer.ride_id;

    -- 1. DEBT LOCK CHECK
    -- Get the driver's auth user id
    SELECT user_id INTO v_driver_user_id FROM drivers WHERE id = v_offer.driver_id;
    
    -- Check balance
    v_balance := get_wallet_balance(v_driver_user_id);
    
    IF v_balance < 0 THEN
        -- Driver is in debt. Mark offer as expired and return false.
        UPDATE ride_offers SET status = 'expired' WHERE id = p_offer_id;
        
        -- Log debt lock event
        INSERT INTO ride_events (ride_id, event_type, actor_type, actor_id, metadata)
        VALUES (v_ride_id, 'driver_debt_lock', 'driver', v_offer.driver_id, jsonb_build_object('balance', v_balance));
        
        RETURN FALSE;
    END IF;

    -- 2. RIDE LOCKING
    PERFORM 1 FROM rides 
    WHERE id = v_ride_id 
    AND status = 'searching' 
    FOR UPDATE;

    IF NOT FOUND THEN 
        UPDATE ride_offers SET status = 'expired' WHERE id = p_offer_id;
        RETURN FALSE; 
    END IF;
    
    -- 3. ATOMIC UPDATE
    UPDATE ride_offers SET status = 'accepted' WHERE id = p_offer_id;
    UPDATE ride_offers SET status = 'expired' WHERE ride_id = v_ride_id AND id != p_offer_id;
    
    UPDATE rides 
    SET driver_id = v_offer.driver_id, 
        status = 'assigned', 
        updated_at = now() 
    WHERE id = v_ride_id;
    
    UPDATE drivers SET status = 'busy' WHERE id = v_offer.driver_id;
    
    INSERT INTO ride_events (ride_id, event_type, actor_type, actor_id, metadata)
    VALUES (v_ride_id, 'ride_assigned', 'driver', v_offer.driver_id, jsonb_build_object('offer_id', p_offer_id));
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
