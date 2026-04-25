-- Setup Ride Messages Table for In-Trip Chat
CREATE TABLE IF NOT EXISTS public.ride_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES auth.users(id),
    content TEXT NOT NULL,
    type TEXT DEFAULT 'text' CHECK (type IN ('text', 'location', 'system')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
-- Enable RLS
ALTER TABLE public.ride_messages ENABLE ROW LEVEL SECURITY;
-- Policies
DROP POLICY IF EXISTS "Users can view messages for their rides" ON public.ride_messages;
CREATE POLICY "Users can view messages for their rides" 
ON public.ride_messages FOR SELECT 
USING (
    EXISTS (
        SELECT 1 FROM public.rides 
        WHERE rides.id = ride_messages.ride_id 
        AND (rides.rider_id = auth.uid() OR rides.driver_id = auth.uid())
    )
);
DROP POLICY IF EXISTS "Users can send messages to their active rides" ON public.ride_messages;
CREATE POLICY "Users can send messages to their active rides" 
ON public.ride_messages FOR INSERT 
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.rides 
        WHERE rides.id = ride_messages.ride_id 
        AND (rides.rider_id = auth.uid() OR rides.driver_id = auth.uid())
    )
);
-- Realtime
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE ride_messages;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;
