-- Fix 1: Prevent Double Dispatch
-- Atomic driver selection with row-level locking

CREATE OR REPLACE FUNCTION claim_available_driver(
  p_pickup_lat double precision,
  p_pickup_lng double precision,
  p_vehicle_type text,
  p_max_distance_km double precision DEFAULT 15
)
RETURNS TABLE (
  driver_id uuid,
  driver_name text,
  driver_lat double precision,
  driver_lng double precision,
  distance_km double precision
) LANGUAGE plpgsql AS $$
DECLARE
  v_driver_id uuid;
BEGIN
  -- Lock the selected driver row atomically.
  -- SKIP LOCKED means: if another transaction already locked
  -- this driver, skip them and find the next available one.
  -- This eliminates the double-dispatch race condition entirely.
  SELECT d.id INTO v_driver_id
  FROM drivers d
  WHERE d.is_online = true
    AND d.status = 'online'
    AND d.wallet_balance_cents > -60000
    AND (p_vehicle_type = 'Any' OR d.vehicle_type = p_vehicle_type)
    AND (
      6371 * acos(
        cos(radians(p_pickup_lat)) * cos(radians(d.lat)) *
        cos(radians(d.lng) - radians(p_pickup_lng)) +
        sin(radians(p_pickup_lat)) * sin(radians(d.lat))
      )
    ) <= p_max_distance_km
  ORDER BY (
    6371 * acos(
      cos(radians(p_pickup_lat)) * cos(radians(d.lat)) *
      cos(radians(d.lng) - radians(p_pickup_lng)) +
      sin(radians(p_pickup_lat)) * sin(radians(d.lat))
    )
  ) ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;  -- THE CRITICAL LINE

  IF v_driver_id IS NULL THEN
    RETURN;  -- No available driver found
  END IF;

  -- Return the claimed driver's details
  RETURN QUERY
  SELECT
    d.id,
    d.name,
    d.lat,
    d.lng,
    6371 * acos(
      cos(radians(p_pickup_lat)) * cos(radians(d.lat)) *
      cos(radians(d.lng) - radians(p_pickup_lng)) +
      sin(radians(p_pickup_lat)) * sin(radians(d.lat))
    ) AS distance_km
  FROM drivers d
  WHERE d.id = v_driver_id;
END;
$$;
