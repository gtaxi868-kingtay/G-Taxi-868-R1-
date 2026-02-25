-- Migration: Ride TTL and Cleanup
-- Adds expiry mechanism to prevent stale rides from blocking the app

-- 1. Add expires_at column for explicit TTL
ALTER TABLE rides ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- 2. Add 'expired' status to rides CHECK constraint (if not exists)
DO $$
BEGIN
    -- First, drop the existing constraint if it exists
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'rides_status_check' AND conrelid = 'rides'::regclass
    ) THEN
        ALTER TABLE rides DROP CONSTRAINT rides_status_check;
    END IF;

    -- Add the expanded constraint
    ALTER TABLE rides ADD CONSTRAINT rides_status_check CHECK (
        status IN (
            'requested', 'searching', 'assigned', 'arrived', 
            'in_progress', 'completed', 'cancelled', 'blocked', 'expired'
        )
    );
END $$;

-- 3. Set default expires_at to 30 minutes from now for new rides
ALTER TABLE rides ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '30 minutes');

-- 4. Create function to expire stale rides (can be called by cron or manually)
CREATE OR REPLACE FUNCTION expire_stale_rides()
RETURNS INTEGER AS $$
DECLARE
    affected_rows INTEGER;
BEGIN
    WITH expired AS (
        UPDATE rides 
        SET status = 'expired', updated_at = NOW()
        WHERE status IN ('searching', 'assigned', 'arrived')
          AND (expires_at < NOW() OR updated_at < NOW() - INTERVAL '30 minutes')
        RETURNING id
    )
    SELECT COUNT(*) INTO affected_rows FROM expired;
    
    RETURN affected_rows;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Clean up any existing stale rides right now
UPDATE rides 
SET status = 'expired', updated_at = NOW()
WHERE status IN ('requested', 'searching', 'assigned', 'arrived', 'in_progress')
  AND updated_at < NOW() - INTERVAL '30 minutes';

-- 6. Grant execute permission
GRANT EXECUTE ON FUNCTION expire_stale_rides() TO authenticated;
GRANT EXECUTE ON FUNCTION expire_stale_rides() TO service_role;

-- Note: For production, you would set up a pg_cron job to call expire_stale_rides() every 5 minutes:
-- SELECT cron.schedule('expire-stale-rides', '*/5 * * * *', 'SELECT expire_stale_rides()');
