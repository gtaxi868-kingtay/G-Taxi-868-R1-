-- 10. Security Fixes and Payment Columns
-- Adds missing payment columns and fixes simulate_ride_update security

-- ============================================
-- 1. ADD PAYMENT COLUMNS TO RIDES TABLE
-- ============================================

-- Add vehicle_type column if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'rides' AND column_name = 'vehicle_type'
    ) THEN
        ALTER TABLE rides ADD COLUMN vehicle_type TEXT DEFAULT 'Standard'
            CHECK (vehicle_type IN ('Standard', 'XL', 'Premium'));
    END IF;
END $$;

-- Add payment_method column if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'rides' AND column_name = 'payment_method'
    ) THEN
        ALTER TABLE rides ADD COLUMN payment_method TEXT DEFAULT 'cash'
            CHECK (payment_method IN ('cash', 'card'));
    END IF;
END $$;

-- Add payment_status column if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'rides' AND column_name = 'payment_status'
    ) THEN
        ALTER TABLE rides ADD COLUMN payment_status TEXT DEFAULT 'pending'
            CHECK (payment_status IN ('pending', 'cash_due', 'paid', 'refunded'));
    END IF;
END $$;

-- ============================================
-- 2. FIX simulate_ride_update SECURITY
-- ============================================
-- This function now validates that the caller is either:
-- 1. The rider who owns the ride, OR
-- 2. The assigned driver
-- It uses SECURITY INVOKER (default) and gets caller ID from auth.uid()

CREATE OR REPLACE FUNCTION public.simulate_ride_update(
    p_ride_id UUID,
    p_status TEXT,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lng DOUBLE PRECISION DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER  -- CHANGED: Uses caller's permissions, not elevated
AS $$
DECLARE
    v_ride RECORD;
    v_caller_id UUID;
    v_is_authorized BOOLEAN := false;
BEGIN
    -- Get the caller's user ID
    v_caller_id := auth.uid();
    
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
    END IF;

    -- 1. Get the ride with ownership info
    SELECT * INTO v_ride FROM rides WHERE id = p_ride_id;
    
    IF v_ride IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ride not found');
    END IF;

    IF v_ride.driver_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ride has no driver assigned');
    END IF;

    -- 2. SECURITY CHECK: Verify caller is authorized
    -- Rider can simulate (for testing)
    IF v_ride.rider_id = v_caller_id THEN
        v_is_authorized := true;
    END IF;
    
    -- Driver can update their own rides
    IF v_ride.driver_id = v_caller_id THEN
        v_is_authorized := true;
    END IF;

    IF NOT v_is_authorized THEN
        -- Log unauthorized attempt
        INSERT INTO events (user_id, role, event_type, metadata)
        VALUES (
            v_caller_id, 
            'unknown', 
            'unauthorized_simulation_attempt', 
            jsonb_build_object(
                'ride_id', p_ride_id, 
                'actual_rider', v_ride.rider_id,
                'actual_driver', v_ride.driver_id
            )
        );
        
        RETURN jsonb_build_object('success', false, 'error', 'Not authorized to update this ride');
    END IF;

    -- 3. Validate status transition
    IF p_status NOT IN ('assigned', 'arrived', 'in_progress', 'completed', 'cancelled') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid status value');
    END IF;

    -- 4. Update Ride Status
    UPDATE rides 
    SET status = p_status, 
        updated_at = now()
    WHERE id = p_ride_id;

    -- 5. Update Driver Location (if provided) - simulates movement
    IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
        -- Validate coordinates
        IF p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN
            RETURN jsonb_build_object('success', false, 'error', 'Invalid coordinates');
        END IF;

        -- Insert into location history
        INSERT INTO driver_locations (driver_id, lat, lng)
        VALUES (v_ride.driver_id, p_lat, p_lng);

        -- Update current driver position
        UPDATE drivers
        SET lat = p_lat, lng = p_lng, updated_at = now()
        WHERE id = v_ride.driver_id;
    END IF;

    -- 6. Log Event (authorized simulation)
    INSERT INTO events (user_id, role, event_type, metadata)
    VALUES (
        v_caller_id, 
        CASE WHEN v_ride.rider_id = v_caller_id THEN 'rider' ELSE 'driver' END,
        'simulation_update', 
        jsonb_build_object('ride_id', p_ride_id, 'status', p_status)
    );

    RETURN jsonb_build_object('success', true, 'status', p_status);
END;
$$;

-- ============================================
-- 3. ADD COMMENTS FOR DOCUMENTATION
-- ============================================
COMMENT ON COLUMN rides.vehicle_type IS 'Vehicle type: Standard (1x), XL (1.5x), Premium (2x)';
COMMENT ON COLUMN rides.payment_method IS 'Payment method: cash or card';
COMMENT ON COLUMN rides.payment_status IS 'Payment status: pending, cash_due, paid, refunded';
COMMENT ON FUNCTION simulate_ride_update IS 'Secure simulation function with ownership validation';
