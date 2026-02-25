-- 015_driver_simulation.sql
-- Add bot flag and vehicle type to drivers table for simulation

-- 1. Add is_bot column (false by default for real drivers)
ALTER TABLE public.drivers 
ADD COLUMN IF NOT EXISTS is_bot BOOLEAN DEFAULT false;

-- 2. Add vehicle_type column for matching
ALTER TABLE public.drivers 
ADD COLUMN IF NOT EXISTS vehicle_type TEXT DEFAULT 'standard' 
CHECK (vehicle_type IN ('standard', 'xl', 'premium'));

-- 3. Update existing seed drivers to be bots with vehicle types
UPDATE public.drivers 
SET is_bot = true, vehicle_type = 'standard' 
WHERE name IN ('Marcus Johnson', 'Sarah Lee', 'Michael Jordan', 'Lisa Ray');

UPDATE public.drivers 
SET is_bot = true, vehicle_type = 'xl' 
WHERE name IN ('David Chen', 'Robert Grant');

UPDATE public.drivers 
SET is_bot = true, vehicle_type = 'premium' 
WHERE name IN ('Priya Singh', 'Jason Thomas', 'Emma Stone', 'James Bond');

-- 4. Ensure all bots are online and positioned near Port of Spain
UPDATE public.drivers 
SET 
    is_online = true, 
    status = 'online',
    -- Randomize positions slightly around Port of Spain (10.6549, -61.5019)
    lat = 10.6549 + (random() - 0.5) * 0.01,
    lng = -61.5019 + (random() - 0.5) * 0.01,
    updated_at = NOW()
WHERE is_bot = true;

-- 5. Create index for fast bot lookup
CREATE INDEX IF NOT EXISTS idx_drivers_is_bot_online 
ON public.drivers(is_bot, is_online);

-- 6. Create function to simulate bot movement (called by Edge Function or cron)
CREATE OR REPLACE FUNCTION public.move_bot_toward_location(
    p_driver_id UUID,
    p_target_lat DOUBLE PRECISION,
    p_target_lng DOUBLE PRECISION,
    p_speed DOUBLE PRECISION DEFAULT 0.0005 -- degrees per call (~50m)
)
RETURNS VOID AS $$
DECLARE
    v_current_lat DOUBLE PRECISION;
    v_current_lng DOUBLE PRECISION;
    v_new_lat DOUBLE PRECISION;
    v_new_lng DOUBLE PRECISION;
    v_heading DOUBLE PRECISION;
BEGIN
    -- Get current position
    SELECT lat, lng INTO v_current_lat, v_current_lng
    FROM public.drivers WHERE id = p_driver_id;
    
    -- Calculate new position (move toward target)
    v_new_lat := v_current_lat + (p_target_lat - v_current_lat) * p_speed * 10;
    v_new_lng := v_current_lng + (p_target_lng - v_current_lng) * p_speed * 10;
    
    -- Calculate heading (degrees)
    v_heading := degrees(atan2(p_target_lng - v_current_lng, p_target_lat - v_current_lat));
    
    -- Update driver position
    UPDATE public.drivers 
    SET lat = v_new_lat, lng = v_new_lng, heading = v_heading, updated_at = NOW()
    WHERE id = p_driver_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
