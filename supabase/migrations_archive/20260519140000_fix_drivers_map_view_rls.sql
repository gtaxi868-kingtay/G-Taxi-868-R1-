BEGIN;

-- Drop old DEFINER view (bypasses RLS — security hole)
DROP VIEW IF EXISTS public.drivers_map_view;

-- Recreate with INVOKER security (respects caller's RLS)
CREATE VIEW public.drivers_map_view
    WITH (security_invoker = true)
AS
    SELECT
        id,
        lat,
        lng,
        heading,
        is_online
    FROM public.drivers
    WHERE is_online = true;

REVOKE ALL ON public.drivers_map_view FROM PUBLIC;
GRANT SELECT ON public.drivers_map_view TO authenticated;

-- Allow any authenticated user to see online drivers' locations
-- REQUIRED because INVOKER mode checks RLS on the drivers table
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='drivers' AND policyname='Anyone can see online drivers') THEN
    DROP POLICY IF EXISTS "Anyone can see online drivers" ON public.drivers;
CREATE POLICY "Anyone can see online drivers" ON public.drivers
        FOR SELECT
        TO authenticated
        USING (is_online = true);
  END IF;
END $$;

COMMIT;
