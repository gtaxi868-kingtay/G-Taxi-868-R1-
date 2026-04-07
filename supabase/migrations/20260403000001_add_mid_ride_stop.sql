-- Migration: 20260403000001_add_mid_ride_stop.sql
-- Enables Riders to add stops mid-ride with automatic fare adjustment.

CREATE OR REPLACE FUNCTION public.add_mid_ride_stop(
    p_ride_id UUID,
    p_place_name TEXT,
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    p_address TEXT DEFAULT ''
)
RETURNS JSONB AS $$
DECLARE
    v_max_order INTEGER;
    v_rider_id UUID;
    v_convenience_fee INTEGER := 500; -- $5.00 Mid-Ride Fee
    v_new_stop_id UUID;
BEGIN
    -- 1. Security Check: Only the rider can add a stop to their active ride
    SELECT rider_id INTO v_rider_id FROM public.rides WHERE id = p_ride_id AND status = 'in_progress';
    IF v_rider_id IS NULL OR v_rider_id != auth.uid() THEN
        RAISE EXCEPTION 'Unauthorized: Ride must be in_progress and owned by requester';
    END IF;

    -- 2. Determine Order
    SELECT COALESCE(MAX(stop_order), 0) INTO v_max_order FROM public.ride_stops WHERE ride_id = p_ride_id;

    -- 3. Insert Stop
    INSERT INTO public.ride_stops (ride_id, stop_order, place_name, place_address, lat, lng, status)
    VALUES (p_ride_id, v_max_order + 1, p_place_name, p_address, p_lat, p_lng, 'pending')
    RETURNING id INTO v_new_stop_id;

    -- 4. Update Ride Fare & Metadata
    UPDATE public.rides 
    SET 
        total_fare_cents = total_fare_cents + v_convenience_fee,
        updated_at = now()
    WHERE id = p_ride_id;

    -- 5. Trigger Event for Driver App
    INSERT INTO public.ride_events (ride_id, event_type, actor_type, actor_id, metadata)
    VALUES (p_ride_id, 'stop_added', 'rider', auth.uid(), jsonb_build_object('place_name', p_place_name, 'stop_id', v_new_stop_id));

    RETURN jsonb_build_object('success', true, 'stop_id', v_new_stop_id, 'new_fare_cents', (SELECT total_fare_cents FROM public.rides WHERE id = p_ride_id));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant access
GRANT EXECUTE ON FUNCTION public.add_mid_ride_stop TO authenticated;
