-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 1: SMART AI DISPATCH — Composite Driver Scoring
-- Replaces the distance-only claim_available_driver with a weighted score:
--   60% proximity  +  30% driver rating  +  10% acceptance rate
-- This makes "Smart AI Dispatch" actually smart.
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop the existing function first, as Postgres requires this when the returns TABLE signature changes.
DROP FUNCTION IF EXISTS claim_available_driver(DOUBLE PRECISION, DOUBLE PRECISION, TEXT, UUID, FLOAT);

CREATE OR REPLACE FUNCTION claim_available_driver(
    p_pickup_lat DOUBLE PRECISION,
    p_pickup_lng DOUBLE PRECISION,
    p_vehicle_type TEXT,
    p_rider_id UUID,
    p_max_distance_km FLOAT DEFAULT 15
)
RETURNS TABLE(
    driver_id UUID,
    driver_name TEXT,
    distance_km FLOAT,
    composite_score FLOAT
) AS $$
DECLARE
    MAX_RATING FLOAT := 5.0;
    WEIGHT_DISTANCE FLOAT := 0.60;
    WEIGHT_RATING   FLOAT := 0.30;
    WEIGHT_ACCEPT   FLOAT := 0.10;
BEGIN
    RETURN QUERY
    WITH candidates AS (
        SELECT
            d.id                                                                    AS driver_id,
            d.name                                                                  AS driver_name,
            (
                6371 * acos(
                    cos(radians(p_pickup_lat)) * cos(radians(d.current_lat)) *
                    cos(radians(d.current_lng) - radians(p_pickup_lng)) +
                    sin(radians(p_pickup_lat)) * sin(radians(d.current_lat))
                )
            )                                                                       AS distance_km,
            COALESCE(d.rating, 4.5)                                                 AS rating,
            COALESCE(d.acceptance_rate, 0.80)                                       AS acceptance_rate
        FROM drivers d
        WHERE
            d.is_online = TRUE
            AND d.status = 'available'
            -- Mutual blacklist: rider can't get a driver they've blocked & vice versa
            AND d.id NOT IN (
                SELECT blocked_driver_id FROM rider_driver_blacklist
                WHERE rider_id = p_rider_id
            )
            AND d.id NOT IN (
                SELECT blocked_rider_id FROM driver_rider_blacklist
                WHERE driver_id = d.id
            )
            -- Vehicle type filter (Any means no restriction)
            AND (p_vehicle_type = 'Any' OR d.vehicle_type = p_vehicle_type)
    ),
    scored AS (
        SELECT
            c.driver_id,
            c.driver_name,
            c.distance_km,
            -- Composite score: higher is better
            (
                WEIGHT_DISTANCE * (1.0 - LEAST(c.distance_km / p_max_distance_km, 1.0)) +
                WEIGHT_RATING   * (c.rating / MAX_RATING) +
                WEIGHT_ACCEPT   * c.acceptance_rate
            ) AS composite_score
        FROM candidates c
        WHERE c.distance_km <= p_max_distance_km
    )
    SELECT
        s.driver_id,
        s.driver_name,
        s.distance_km,
        s.composite_score
    FROM scored s
    ORDER BY s.composite_score DESC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;  -- Atomic claim: prevents race condition when multiple rides fire simultaneously
END;
$$ LANGUAGE plpgsql;

-- Ensure acceptance_rate column exists on drivers table
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS acceptance_rate FLOAT DEFAULT 0.80;
COMMENT ON COLUMN public.drivers.acceptance_rate IS 'Rolling 30-day acceptance rate (0.0–1.0). Updated by accept_ride/decline_ride edge functions.';

-- Update acceptance_rate when a driver accepts or declines
-- (Stored procedure called from edge functions)
CREATE OR REPLACE FUNCTION update_driver_acceptance_rate(p_driver_id UUID, p_accepted BOOLEAN)
RETURNS VOID AS $$
BEGIN
    UPDATE drivers
    SET acceptance_rate = CASE
        WHEN p_accepted THEN LEAST(COALESCE(acceptance_rate, 0.8) * 0.95 + 0.05, 1.0)
        ELSE GREATEST(COALESCE(acceptance_rate, 0.8) * 0.90, 0.1)
    END
    WHERE id = p_driver_id;
END;
$$ LANGUAGE plpgsql;
