-- 014_trust_safety.sql

-- Add emergency_contact to profiles if it doesn't exist
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS emergency_contact TEXT;

-- Add share_token to rides for public tracking
ALTER TABLE public.rides 
ADD COLUMN IF NOT EXISTS share_token TEXT;

-- Create index for faster lookups by share_token
CREATE INDEX IF NOT EXISTS idx_rides_share_token ON public.rides(share_token);

-- Create table for logging SOS events
CREATE TABLE IF NOT EXISTS public.sos_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    ride_id UUID REFERENCES public.rides(id), -- Optional, if triggered during a ride
    location JSONB, -- Store lat/lng at time of trigger
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE,
    status TEXT DEFAULT 'triggered' CHECK (status IN ('triggered', 'acknowledged', 'resolved'))
);

-- Enable RLS on sos_events
ALTER TABLE public.sos_events ENABLE ROW LEVEL SECURITY;

-- Drop existing policies (for re-runs)
DROP POLICY IF EXISTS "Users can insert own SOS events" ON public.sos_events;
DROP POLICY IF EXISTS "Users can view own SOS events" ON public.sos_events;
DROP POLICY IF EXISTS "Service role full access on sos_events" ON public.sos_events;

-- Policy: Users can insert their own SOS events
CREATE POLICY "Users can insert own SOS events" 
ON public.sos_events 
FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id);

-- Policy: Users can view their own SOS events
CREATE POLICY "Users can view own SOS events" 
ON public.sos_events 
FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

-- Policy: Service role has full access
CREATE POLICY "Service role full access on sos_events" 
ON public.sos_events 
FOR ALL 
TO service_role 
USING (true) 
WITH CHECK (true);
