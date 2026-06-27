-- ── find_nearest_online_drivers RPC ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.find_nearest_online_drivers(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_radius_meters INTEGER DEFAULT 3000,
  p_limit INTEGER DEFAULT 1
) RETURNS TABLE (
  driver_id UUID,
  push_token TEXT,
  distance_meters DOUBLE PRECISION
) LANGUAGE sql SECURITY DEFINER AS $$
  SELECT 
    d.id AS driver_id,
    d.push_token,
    st_distance(
      st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
      st_setsrid(st_makepoint(d.last_lng, d.last_lat), 4326)::geography
    ) AS distance_meters
  FROM public.drivers d
  WHERE d.is_online = true
    AND d.last_lat IS NOT NULL
    AND d.last_lng IS NOT NULL
    AND st_dwithin(
      st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
      st_setsrid(st_makepoint(d.last_lng, d.last_lat), 4326)::geography,
      p_radius_meters
    )
  ORDER BY distance_meters ASC
  LIMIT p_limit;
$$;

-- ── pg_cron for process_dispatch_queue (Runs every minute) ───────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule('process-dispatch-queue-1min');
        PERFORM cron.schedule(
            'process-dispatch-queue-1min',
            '* * * * *',
            $$
            SELECT net.http_post(
                url := current_setting('app.supabase_url') || '/functions/v1/process_dispatch_queue',
                headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'Authorization', 'Bearer ' || current_setting('app.service_role_key')
                ),
                body := '{}'::jsonb
            )
            $$
        );
    END IF;
END;
$$;

-- ── pg_cron for generate_b2b_invoices (Runs at 00:00 on the 1st of every month) ──
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule('generate-b2b-invoices-monthly');
        PERFORM cron.schedule(
            'generate-b2b-invoices-monthly',
            '0 0 1 * *',
            $$
            SELECT net.http_post(
                url := current_setting('app.supabase_url') || '/functions/v1/generate_b2b_invoices',
                headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'Authorization', 'Bearer ' || current_setting('app.service_role_key')
                ),
                body := '{}'::jsonb
            )
            $$
        );
    END IF;
END;
$$;
