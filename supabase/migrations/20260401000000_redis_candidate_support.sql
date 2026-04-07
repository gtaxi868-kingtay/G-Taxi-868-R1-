-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 2: THE GPS REDIS PIPELINE — Candidate Injection
-- Updates claim_available_driver to accept pre-filtered candidates from Redis.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Drop existing function to update signature
DROP FUNCTION IF EXISTS claim_available_driver(DOUBLE PRECISION, DOUBLE PRECISION, TEXT, UUID, FLOAT);

CREATE OR REPLACE FUNCTION claim_available_driver(
    p_pickup_lat DOUBLE PRECISION,
    p_pickup_lng DOUBLE PRECISION,
    p_vehicle_type TEXT,
    p_rider_id UUID,
    p_max_distance_km FLOAT DEFAULT 15,
    p_candidate_ids UUID[] DEFAULT NULL -- The IDs pre-filtered by Redis
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
            -- If we have candidate IDs from Redis, we still calculate distance for scoring 
            -- but the search space is now limited to just those IDs.
            (
                6371 * acos(
                    cos(radians(p_pickup_lat)) * cos(radians(d.lat)) *
                    cos(radians(d.lng) - radians(p_pickup_lng)) +
                    sin(radians(p_pickup_lat)) * sin(radians(d.lat))
                )
            )                                                                       AS distance_km,
            COALESCE(d.rating, 4.5)                                                 AS rating,
            COALESCE(d.acceptance_rate, 0.80)                                       AS acceptance_rate
        FROM drivers d
        WHERE
            -- Mandatory online/available check
            d.is_online = TRUE
            AND d.status = 'available'
            
            -- CANDIDATE FILTERING (The Redis Optimization)
            -- If p_candidate_ids is provided, we ONLY check those drivers.
            -- This bypasses the full-table geographic scan.
            AND (p_candidate_ids IS NULL OR d.id = ANY(p_candidate_ids))
            
            -- Mutual blacklist
            AND d.id NOT IN (
                SELECT blocked_driver_id FROM rider_driver_blacklist
                WHERE rider_id = p_rider_id
            )
            AND d.id NOT IN (
                SELECT blocked_rider_id FROM driver_rider_blacklist
                WHERE driver_id = d.id
            )
            -- Vehicle type filter
            AND (p_vehicle_type = 'Any' OR d.vehicle_type = p_vehicle_type)
    ),
    scored AS (
        SELECT
            c.driver_id,
            c.driver_name,
            c.distance_km,
            (
                WEIGHT_DISTANCE * (1.0 - LEAST(c.distance_km / p_max_distance_km, 1.0)) +
                WEIGHT_RATING   * (c.rating / MAX_RATING) +
                WEIGHT_ACCEPT   * c.acceptance_rate
            ) AS composite_score
        FROM candidates c
        WHERE (p_candidate_ids IS NOT NULL) OR (c.distance_km <= p_max_distance_km)
    )
    SELECT
        s.driver_id,
        s.driver_name,
        s.distance_km,
        s.composite_score
    FROM scored s
    ORDER BY s.composite_score DESC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
END;
$$ LANGUAGE plpgsql;
