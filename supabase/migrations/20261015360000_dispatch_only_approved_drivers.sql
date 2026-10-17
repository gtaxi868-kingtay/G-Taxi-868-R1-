-- ═══════════════════════════════════════════════════════════════════
-- Delivery dispatch only offers jobs to approved, available drivers.
--
-- Before (verified live 2026-10-15): find_nearest_online_drivers (used by
-- process_dispatch_queue and platform_intelligence) only checked
-- is_online, so an unapproved driver, a bot, or a driver marked busy/
-- offline whose is_online flag was left on (live: "Test Driver Sim" has
-- is_online=true, status='offline') could be offered a delivery.
--
-- After: also requires verified_status = 'approved', status = 'online',
-- not a bot. Same signature and return shape; existing grants kept.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.find_nearest_online_drivers(
  p_lat double precision,
  p_lng double precision,
  p_radius_meters double precision DEFAULT 3000,
  p_limit integer DEFAULT 1)
RETURNS TABLE(driver_id uuid, push_token text, distance_m double precision)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    d.id AS driver_id,
    d.push_token,
    ST_Distance(d.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) AS distance_m
  FROM drivers d
  WHERE d.is_online = true
    AND d.status = 'online'
    AND d.verified_status = 'approved'
    AND COALESCE(d.is_bot, false) = false
    AND d.active_ride_id IS NULL
    AND COALESCE(d.spoof_suspended, false) = false
    AND d.location IS NOT NULL
    AND ST_DWithin(d.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_radius_meters)
  ORDER BY distance_m ASC
  LIMIT p_limit;
$function$;
