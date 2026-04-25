-- Add ride_pin column to rides table for ghost ride prevention
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS ride_pin TEXT;
-- Generate a random 4-digit PIN for existing active rides (optional, but good for consistency)
UPDATE public.rides 
SET ride_pin = floor(random() * 9000 + 1000)::text 
WHERE ride_pin IS NULL AND status IN ('requested', 'searching', 'assigned', 'arrived');
