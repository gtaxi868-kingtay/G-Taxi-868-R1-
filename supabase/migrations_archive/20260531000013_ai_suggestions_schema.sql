CREATE TABLE IF NOT EXISTS public.ride_suggestions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    ride_id uuid REFERENCES public.rides(id) ON DELETE CASCADE NOT NULL,
    generated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    suggestions jsonb NOT NULL,
    context_telemetry jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE public.ride_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Riders can interact with their specific suggestions" ON public.ride_suggestions
    FOR SELECT USING (
        ride_id IN (SELECT id FROM public.rides WHERE rider_id = auth.uid())
    );
