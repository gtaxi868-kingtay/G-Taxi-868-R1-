-- Enable Realtime for ride_events to support persistent AI Insights
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE ride_events;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Ensure RLS allows authenticated users to see events for their rides
ALTER TABLE public.ride_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see events for their rides" ON public.ride_events;
CREATE POLICY "Users see events for their rides" ON public.ride_events
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.rides 
        WHERE rides.id = ride_events.ride_id 
        AND (rides.rider_id = auth.uid() OR rides.driver_id = (SELECT id FROM drivers WHERE user_id = auth.uid()))
    )
);
