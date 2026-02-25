-- 9. Simulation Utilities (Dev Tools)
-- Allows the Rider App to simulate Driver actions until the Driver App is built.

CREATE OR REPLACE FUNCTION public.simulate_ride_update(
    p_ride_id UUID,
    p_status TEXT,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lng DOUBLE PRECISION DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- Runs as generic service role to bypass rider RLS checks for 'driver' actions
AS $$
DECLARE
    v_driver_id UUID;
    v_updated_ride RECORD;
BEGIN
    -- 1. Get the ride and driver
    SELECT driver_id INTO v_driver_id FROM rides WHERE id = p_ride_id;
    
    IF v_driver_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ride has no driver assigned');
    END IF;

    -- 2. Update Ride Status
    UPDATE rides 
    SET status = p_status, 
        updated_at = now()
    WHERE id = p_ride_id
    RETURNING * INTO v_updated_ride;

    -- 3. Update Driver Location (if provided) - simulates movement
    IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
        -- Link to our existing logic
        INSERT INTO driver_locations (driver_id, lat, lng)
        VALUES (v_driver_id, p_lat, p_lng);

        UPDATE drivers
        SET lat = p_lat, lng = p_lng, updated_at = now()
        WHERE id = v_driver_id;
    END IF;

    -- 4. Log Event
    INSERT INTO events (user_id, role, event_type, metadata)
    VALUES (v_driver_id, 'system', 'simulation_update', jsonb_build_object('ride_id', p_ride_id, 'status', p_status));

    RETURN jsonb_build_object('success', true, 'status', p_status);
END;
$$;
