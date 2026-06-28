-- Migration to support Dual Wait Clocks
ALTER TABLE rides 
ADD COLUMN IF NOT EXISTS pickup_wait_seconds INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS stop_wait_seconds INTEGER DEFAULT 0;

-- Comment for clarity
COMMENT ON COLUMN rides.pickup_wait_seconds IS 'Wait time at initial arrival before ride start (Eligible for 3-min grace)';
COMMENT ON COLUMN rides.stop_wait_seconds IS 'Wait time at intermediate stops (Billed per second, no grace)';
