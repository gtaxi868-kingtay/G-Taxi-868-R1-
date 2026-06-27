-- Fix Case Sensitivity in Vehicle Matching
-- Updates dispatch_ride_to_drivers to use ILIKE

CREATE OR REPLACE FUNCTION dispatch_ride_to_drivers(p_ride_id UUID) RETURNS INTEGER AS $$
DECLARE
    v_ride RECORD;
    v_driver RECORD;
    v_count INTEGER := 0;
    v_search_radius_meters INTEGER := 50000; -- 50km (Whole Island Coverage)
BEGIN
    -- Fetch Ride Details
    SELECT * INTO v_ride FROM rides WHERE id = p_ride_id;
    
    -- specific validations
    IF v_ride IS NULL OR v_ride.status != 'searching' THEN 
        RETURN 0; 
    END IF;

    -- Geospatial Query for Drivers
    FOR v_driver IN 
        SELECT 
            id, 
            lat, 
            lng, 
            vehicle_type,
            ST_Distance(location, ST_SetSRID(ST_MakePoint(v_ride.pickup_lng, v_ride.pickup_lat), 4326)) as distance
        FROM drivers 
        WHERE 
            status = 'online' 
            AND is_online = true
            -- Vehicle Type Logic (Case Insensitive Fix)
            AND (
                (v_ride.vehicle_type ILIKE 'standard') OR 
                (v_ride.vehicle_type ILIKE 'xl' AND vehicle_type IN ('xl', 'premium')) OR
                (v_ride.vehicle_type ILIKE 'premium' AND vehicle_type = 'premium')
            )
            -- Geospatial Filter (Within 50km)
            AND ST_DWithin(
                location, 
                ST_SetSRID(ST_MakePoint(v_ride.pickup_lng, v_ride.pickup_lat), 4326), 
                v_search_radius_meters
            )
        ORDER BY distance ASC -- Closest First
        LIMIT 20 -- Broadcast to 20 closest drivers
    LOOP
        -- Insert Offer
        INSERT INTO ride_offers (ride_id, driver_id, distance_meters)
        VALUES (p_ride_id, v_driver.id, v_driver.distance)
        ON CONFLICT DO NOTHING;
        
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
