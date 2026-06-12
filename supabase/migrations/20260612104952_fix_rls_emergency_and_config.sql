-- Fix RLS: emergency_logs INSERT restricted to ride participants
DROP POLICY IF EXISTS "Edge functions can insert emergency logs" ON public.emergency_logs;
CREATE POLICY "Rider or driver can insert emergency logs"
  ON public.emergency_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = rider_id
    OR
    auth.uid() IN (SELECT user_id FROM public.drivers WHERE id = driver_id)
  );

-- Fix RLS: system_config restricted to authenticated users (was world-readable)
DROP POLICY IF EXISTS "Anyone can read system config" ON public.system_config;
CREATE POLICY "Authenticated users can read system config"
  ON public.system_config FOR SELECT
  TO authenticated
  USING (true);

-- Recreate service role policy for system_config (retained as-is)
DROP POLICY IF EXISTS "Service role manages system config" ON public.system_config;
CREATE POLICY "Service role manages system config"
  ON public.system_config FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
