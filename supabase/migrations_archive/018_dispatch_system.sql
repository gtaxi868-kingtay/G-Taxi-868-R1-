-- Migration: Dispatch System
-- Creates the infrastructure for automatic driver matching

-- ============================================================
-- 1. RIDE OFFERS TABLE
-- Tracks ride offers sent to drivers
-- ============================================================

CREATE TABLE IF NOT EXISTS ride_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
    distance_meters INTEGER, -- Driver's distance to pickup when offer created
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 seconds'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Prevent duplicate offers for same ride/driver
    UNIQUE(ride_id, driver_id)
);

-- Index for fast driver lookup
CREATE INDEX IF NOT EXISTS idx_ride_offers_driver_status 
ON ride_offers(driver_id, status);

-- Index for fast ride lookup
CREATE INDEX IF NOT EXISTS idx_ride_offers_ride_status 
ON ride_offers(ride_id, status);

-- ============================================================
-- 2. RLS POLICIES FOR RIDE OFFERS
-- Drivers can only see and update their own offers
-- ============================================================

ALTER TABLE ride_offers ENABLE ROW LEVEL SECURITY;

-- Drop existing policies (for re-runs)
DROP POLICY IF EXISTS "Drivers can view own offers" ON ride_offers;
DROP POLICY IF EXISTS "Drivers can update own pending offers" ON ride_offers;
DROP POLICY IF EXISTS "Service role full access" ON ride_offers;

-- Drivers can view their own offers
CREATE POLICY "Drivers can view own offers" ON ride_offers
    FOR SELECT USING (
        driver_id IN (
            SELECT id FROM drivers WHERE user_id = auth.uid()
        )
    );

-- Drivers can update their own pending offers (accept/decline)
CREATE POLICY "Drivers can update own pending offers" ON ride_offers
    FOR UPDATE USING (
        driver_id IN (
            SELECT id FROM drivers WHERE user_id = auth.uid()
        )
        AND status = 'pending'
    );

-- Service role can do everything (for dispatch function)
CREATE POLICY "Service role full access" ON ride_offers
    FOR ALL USING (
        auth.jwt() ->> 'role' = 'service_role'
    );

-- ============================================================
-- 3. FUNCTION TO DISPATCH RIDE TO NEARBY DRIVERS
-- Called by trigger or manually
-- ============================================================

CREATE OR REPLACE FUNCTION dispatch_ride_to_drivers(p_ride_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_ride RECORD;
    v_driver RECORD;
    v_offer_count INTEGER := 0;
    v_max_distance_meters INTEGER := 10000; -- 10km radius
BEGIN
    -- Get ride details
    SELECT * INTO v_ride FROM rides WHERE id = p_ride_id;
    
    IF v_ride IS NULL OR v_ride.status != 'searching' THEN
        RETURN 0; -- Ride not found or not searching
    END IF;
    
    -- Find online drivers within radius (simplified - uses bounding box)
    FOR v_driver IN
        SELECT 
            d.id,
            d.lat,
            d.lng,
            -- Haversine distance approximation (rough, but fast)
            (
                6371000 * acos(
                    cos(radians(v_ride.pickup_lat)) * cos(radians(d.lat)) * 
                    cos(radians(d.lng) - radians(v_ride.pickup_lng)) +
                    sin(radians(v_ride.pickup_lat)) * sin(radians(d.lat))
                )
            )::INTEGER as distance_meters
        FROM drivers d
        WHERE d.is_online = true
        AND d.status = 'online'
        AND d.lat IS NOT NULL
        AND d.lng IS NOT NULL
        -- Bounding box filter (faster than full distance calc)
        AND d.lat BETWEEN v_ride.pickup_lat - 0.1 AND v_ride.pickup_lat + 0.1
        AND d.lng BETWEEN v_ride.pickup_lng - 0.1 AND v_ride.pickup_lng + 0.1
        ORDER BY distance_meters ASC
        LIMIT 5 -- Send to 5 closest drivers
    LOOP
        -- Only offer to drivers within max distance
        IF v_driver.distance_meters <= v_max_distance_meters THEN
            INSERT INTO ride_offers (ride_id, driver_id, distance_meters)
            VALUES (p_ride_id, v_driver.id, v_driver.distance_meters)
            ON CONFLICT (ride_id, driver_id) DO NOTHING;
            
            v_offer_count := v_offer_count + 1;
        END IF;
    END LOOP;
    
    RETURN v_offer_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. FUNCTION TO ACCEPT RIDE OFFER
-- Called when driver accepts - assigns driver to ride
-- ============================================================

CREATE OR REPLACE FUNCTION accept_ride_offer(p_offer_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_offer RECORD;
    v_ride RECORD;
BEGIN
    -- Get offer details
    SELECT * INTO v_offer FROM ride_offers WHERE id = p_offer_id;
    
    IF v_offer IS NULL OR v_offer.status != 'pending' THEN
        RETURN FALSE; -- Offer not found or not pending
    END IF;
    
    -- Check if offer expired
    IF v_offer.expires_at < NOW() THEN
        UPDATE ride_offers SET status = 'expired', updated_at = NOW() WHERE id = p_offer_id;
        RETURN FALSE;
    END IF;
    
    -- Get ride and check if still searching
    SELECT * INTO v_ride FROM rides WHERE id = v_offer.ride_id;
    
    IF v_ride IS NULL OR v_ride.status != 'searching' THEN
        RETURN FALSE; -- Ride already taken or cancelled
    END IF;
    
    -- Accept this offer
    UPDATE ride_offers 
    SET status = 'accepted', updated_at = NOW() 
    WHERE id = p_offer_id;
    
    -- Expire all other offers for this ride
    UPDATE ride_offers 
    SET status = 'expired', updated_at = NOW() 
    WHERE ride_id = v_offer.ride_id AND id != p_offer_id;
    
    -- Assign driver to ride
    UPDATE rides 
    SET 
        driver_id = v_offer.driver_id, 
        status = 'assigned',
        updated_at = NOW()
    WHERE id = v_offer.ride_id;
    
    -- Update driver status
    UPDATE drivers
    SET status = 'busy', updated_at = NOW()
    WHERE id = v_offer.driver_id;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 5. TRIGGER TO AUTO-DISPATCH ON RIDE CREATION
-- ============================================================

CREATE OR REPLACE FUNCTION trigger_dispatch_on_ride_insert()
RETURNS TRIGGER AS $$
BEGIN
    -- Only dispatch if status is 'searching'
    IF NEW.status = 'searching' THEN
        PERFORM dispatch_ride_to_drivers(NEW.id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger (drop first if exists)
DROP TRIGGER IF EXISTS dispatch_ride_trigger ON rides;

CREATE TRIGGER dispatch_ride_trigger
AFTER INSERT ON rides
FOR EACH ROW
EXECUTE FUNCTION trigger_dispatch_on_ride_insert();

-- ============================================================
-- 6. GRANT PERMISSIONS
-- ============================================================

GRANT SELECT, INSERT, UPDATE ON ride_offers TO authenticated;
GRANT EXECUTE ON FUNCTION dispatch_ride_to_drivers(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION accept_ride_offer(UUID) TO authenticated;

-- ============================================================
-- 7. CLEAN UP STALE RIDES (run this now)
-- ============================================================

-- Cancel any rides stuck in searching state
UPDATE rides 
SET status = 'expired', updated_at = NOW()
WHERE status IN ('searching', 'requested', 'assigned')
AND updated_at < NOW() - INTERVAL '30 minutes';

-- ============================================================
-- 8. ENABLE REALTIME FOR RIDE_OFFERS
-- This is CRITICAL for drivers to receive offers via subscription
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND tablename = 'ride_offers'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE ride_offers;
    END IF;
    
    -- Also ensure rides table is in publication
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND tablename = 'rides'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE rides;
    END IF;
    
    -- And drivers table
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND tablename = 'drivers'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE drivers;
    END IF;
END $$;
