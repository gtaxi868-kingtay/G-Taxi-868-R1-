-- G-TAXI HARDENING: Fix 5 - Wait Clock & PIN Start
-- Adds infrastructure for $0.90/min wait fees and secure ride validation.

-- 1. Add columns to rides table
ALTER TABLE rides ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS ride_pin TEXT; -- Keeping ride_pin as per existing schema
ALTER TABLE rides ADD COLUMN IF NOT EXISTS wait_fee_cents INTEGER DEFAULT 0;

-- 2. Function to generate a random 4-digit PIN
CREATE OR REPLACE FUNCTION generate_rider_pin() 
RETURNS TEXT AS $$
BEGIN
    RETURN LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- 3. Trigger to auto-generate PIN on ride creation
CREATE OR REPLACE FUNCTION set_ride_pin()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.ride_pin IS NULL THEN
        NEW.ride_pin := generate_rider_pin();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_set_ride_pin ON rides;
CREATE TRIGGER tr_set_ride_pin
    BEFORE INSERT ON rides
    FOR EACH ROW
    EXECUTE FUNCTION set_ride_pin();

-- 4. Update existing rides if any (security)
UPDATE rides SET ride_pin = generate_rider_pin() WHERE ride_pin IS NULL;


