-- Fix RLS to allow drivers to see rides they have an offer for
-- Currently they can only see rides where driver_id = auth.uid()

CREATE POLICY "Drivers can view offered rides" ON public.rides 
FOR SELECT TO authenticated 
USING (
    EXISTS (
        SELECT 1 FROM ride_offers 
        WHERE ride_offers.ride_id = rides.id 
        AND ride_offers.driver_id = auth.uid()
    )
);
