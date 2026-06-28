-- SAFE EXPIRE RIDE RPC
-- Created to remove direct DB write from ActiveRideRestorationHandler
-- Part of Authority Consolidation (Step 2)

CREATE OR REPLACE FUNCTION public.expire_ride(p_ride_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_ride_id UUID;
    v_status public.ride_status;
BEGIN
    -- 1. Verify ride exists and belongs to user (or is accessible)
    -- We allow the rider to expire their own ride if it's stale
    SELECT id, status INTO v_ride_id, v_status
    FROM public.rides
    WHERE id = p_ride_id
    AND rider_id = auth.uid(); -- Strict RLS: only rider can expire own ride

    IF v_ride_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ride not found or access denied');
    END IF;

    -- 2. Validate current status allows expiration (don't expire completed rides)
    IF v_status IN ('completed', 'cancelled', 'expired') THEN
         RETURN jsonb_build_object('success', false, 'error', 'Ride already terminal');
    END IF;

    -- 3. Perform Update
    UPDATE public.rides
    SET 
        status = 'expired',
        updated_at = NOW()
    WHERE id = p_ride_id;

    RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
