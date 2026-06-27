CREATE TABLE IF NOT EXISTS public.emergency_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
    rider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'triggered' CHECK (status IN ('triggered', 'acknowledged', 'resolved', 'false_alarm')),
    metadata JSONB DEFAULT '{}'::jsonb,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.emergency_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own emergency logs"
    ON public.emergency_logs FOR SELECT
    USING (rider_id = auth.uid() OR driver_id = auth.uid());

CREATE POLICY "Edge functions can insert emergency logs"
    ON public.emergency_logs FOR INSERT
    WITH CHECK (true);

CREATE INDEX idx_emergency_logs_ride_id ON public.emergency_logs(ride_id);
CREATE INDEX idx_emergency_logs_status ON public.emergency_logs(status);
