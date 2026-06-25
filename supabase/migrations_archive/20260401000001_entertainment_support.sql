-- Add entertainment support to rides table
ALTER TABLE rides ADD COLUMN IF NOT EXISTS entertainment_url text;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS entertainment_status text DEFAULT 'pending'; -- 'pending', 'accepted', 'rejected'
ALTER TABLE rides ADD COLUMN IF NOT EXISTS is_premium_ride boolean DEFAULT false;

-- Create an index to help with real-time lookups if needed
CREATE INDEX IF NOT EXISTS idx_rides_entertainment_status ON rides(entertainment_status) WHERE entertainment_status = 'pending';

-- Add a comment for clarity
COMMENT ON COLUMN rides.entertainment_url IS 'The Spotify or YouTube URL suggested by the rider.';
COMMENT ON COLUMN rides.entertainment_status IS 'The driver approval state for the music suggestion.';
