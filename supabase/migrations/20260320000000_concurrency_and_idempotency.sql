-- Migration: 20260320000000_concurrency_and_idempotency.sql
-- Hardens the ride acceptance process against race conditions.

BEGIN;
-- 1. Improved accept_ride_offer with row locking
CREATE OR REPLACE FUNCTION accept_ride_offer(p_offer_id UUID) RETURNS BOOLEAN AS $$
DECLARE
    v_offer RECORD;
    v_ride_id UUID;
BEGIN
    -- Get the offer details
    SELECT * INTO v_offer FROM ride_offers WHERE id = p_offer_id;
    IF v_offer IS NULL OR v_offer.status != 'pending' THEN RETURN FALSE; END IF;
    
    v_ride_id := v_offer.ride_id;

    -- CRITICAL: Lock the ride row for update to prevent other drivers from accepting
    -- if the status check and update happen simultaneously.
    PERFORM 1 FROM rides 
    WHERE id = v_ride_id 
    AND status = 'searching' 
    FOR UPDATE;

    IF NOT FOUND THEN 
        -- Ride is no longer available (already assigned, cancelled, etc.)
        UPDATE ride_offers SET status = 'expired' WHERE id = p_offer_id;
        RETURN FALSE; 
    END IF;
    
    -- 2. Atomic Update
    -- Mark this offer as accepted
    UPDATE ride_offers SET status = 'accepted' WHERE id = p_offer_id;
    
    -- Mark all other offers for this ride as expired
    UPDATE ride_offers SET status = 'expired' WHERE ride_id = v_ride_id AND id != p_offer_id;
    
    -- Assign driver to ride and update status
    UPDATE rides 
    SET driver_id = v_offer.driver_id, 
        status = 'assigned', 
        updated_at = now() 
    WHERE id = v_ride_id;
    
    -- Mark driver as busy
    UPDATE drivers SET status = 'busy' WHERE id = v_offer.driver_id;
    
    -- Log Event
    INSERT INTO ride_events (ride_id, event_type, actor_type, actor_id, metadata)
    VALUES (v_ride_id, 'ride_assigned', 'driver', v_offer.driver_id, jsonb_build_object('offer_id', p_offer_id));
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
COMMIT;
