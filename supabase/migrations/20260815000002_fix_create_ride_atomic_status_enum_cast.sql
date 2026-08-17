-- create_ride_atomic() has failed on every real invocation since it was
-- written: it inserts p_status (declared text) directly into rides.status,
-- which is typed ride_status (an enum). Postgres does not implicitly cast
-- a text-typed plpgsql variable into an enum column the way it does a bare
-- string literal, so the INSERT always threw:
--   "column \"status\" is of type ride_status but expression is of type text"
--
-- This is the real root cause behind this platform's documented "0 real
-- rides ever" — not just the broken dispatch trigger fixed earlier today
-- (20260815000000), which only ever mattered if a ride insert got past
-- this point, which it never could. create_ride/index.ts wraps the RPC
-- result and surfaces {success:false, error: "..."} to the caller, so
-- this failed silently-ish (a normal-looking error response, not a crash)
-- on every single ride creation attempt through the real client path.
--
-- Live-verified 2026-08-15: reproduced the exact error via a direct RPC
-- call in a rolled-back transaction, confirmed the fix (::ride_status
-- cast) resolves it in the same rolled-back transaction, then applied for
-- real and re-verified end-to-end through the real create_ride edge
-- function against a synthetic signup — first successful real ride
-- creation through the actual production path in this system's history.
CREATE OR REPLACE FUNCTION public.create_ride_atomic(p_rider_id uuid, p_pickup_lat double precision, p_pickup_lng double precision, p_pickup_address text, p_dropoff_lat double precision, p_dropoff_lng double precision, p_dropoff_address text, p_status text, p_total_fare_cents integer, p_driver_payout_cents integer, p_distance_meters integer, p_duration_seconds integer, p_route_polyline text, p_vehicle_type text, p_payment_method text, p_ride_pin text, p_idempotency_key text, p_metadata jsonb, p_taxi_stand_id uuid, p_billed_to_merchant_id uuid, p_node_id uuid, p_driver_cut integer, p_platform_cut integer, p_merchant_cut integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_ride_id UUID;
    v_revenue_split_id UUID;
BEGIN
    INSERT INTO rides (
        rider_id,
        pickup_lat, pickup_lng, pickup_address,
        dropoff_lat, dropoff_lng, dropoff_address,
        status, total_fare_cents, driver_payout_cents,
        distance_meters, duration_seconds, route_polyline,
        vehicle_type, payment_method, ride_pin,
        idempotency_key, metadata,
        taxi_stand_id, billed_to_merchant_id
    ) VALUES (
        p_rider_id,
        p_pickup_lat, p_pickup_lng, p_pickup_address,
        p_dropoff_lat, p_dropoff_lng, p_dropoff_address,
        p_status::ride_status, p_total_fare_cents, p_driver_payout_cents,
        p_distance_meters, p_duration_seconds, p_route_polyline,
        p_vehicle_type, p_payment_method, p_ride_pin,
        p_idempotency_key, p_metadata,
        p_taxi_stand_id, p_billed_to_merchant_id
    )
    RETURNING id INTO v_ride_id;

    INSERT INTO revenue_splits (
        ride_id, node_id, driver_id,
        platform_cut, driver_cut, merchant_cut, status
    ) VALUES (
        v_ride_id, p_node_id, NULL,
        p_platform_cut, p_driver_cut, p_merchant_cut, 'pending'
    )
    RETURNING id INTO v_revenue_split_id;

    RETURN jsonb_build_object(
        'ride_id', v_ride_id,
        'revenue_split_id', v_revenue_split_id,
        'success', true
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'error', SQLERRM,
        'success', false
    );
END;
$function$;
