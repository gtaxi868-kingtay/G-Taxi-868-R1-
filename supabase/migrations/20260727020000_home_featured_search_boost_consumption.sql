-- ═══════════════════════════════════════════════════════════════════
-- MERCHANT PROMOTIONS: 'home_featured'/'search_boost' CONSUMPTION (2026-07-27)
--
-- The 2026-07-27 promotion-consumption fix only wired 'suggested_stop'/
-- 'map_pin' into get_nearby_merchants (the EDGE FUNCTION used for
-- along-route stop suggestions). A second, separate 'home_featured'/
-- 'search_boost' surface was still unwired: HomeScreen.tsx's grocery/
-- service storefront calls a DIFFERENT, plain Postgres RPC of the SAME
-- NAME (get_nearby_merchants) directly via supabase.rpc(...) — a real
-- rider-facing merchant list that existed before any of this and had
-- zero promotion awareness. A merchant choosing 'home_featured' or
-- 'search_boost' would have paid for a type that did nothing at all.
--
-- Same real discipline as before: eligibility to be boosted (is_active,
-- in-window, AND spent_cents + cost <= budget_cents) is computed with
-- the exact same math charge_promotion_impression() itself enforces, so
-- what's displayed as "promoted" always matches what actually gets
-- billed for that same request — no case where a merchant is shown
-- boosted but not charged, or charged without being shown boosted.
-- ═══════════════════════════════════════════════════════════════════

-- Adding is_promoted changes the row type — CREATE OR REPLACE can't do
-- that across an incompatible return shape, the function must be dropped
-- first.
DROP FUNCTION IF EXISTS "public"."get_nearby_merchants"(double precision, double precision, double precision, "text");

CREATE FUNCTION "public"."get_nearby_merchants"(
    "p_lat" double precision, "p_lng" double precision,
    "p_radius_km" double precision DEFAULT 10, "p_store_type" "text" DEFAULT 'grocery'::"text"
)
RETURNS TABLE(
    "id" "uuid", "name" "text", "store_type" "text", "lat" double precision, "lng" double precision,
    "address" "text", "delivery_fee_cents" integer, "minimum_order_cents" integer,
    "avg_delivery_minutes" integer, "cover_image_url" "text", "is_open" boolean,
    "opens_at" time without time zone, "closes_at" time without time zone,
    "distance_meters" integer, "is_promoted" boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_uid uuid := auth.uid();
    rec RECORD;
BEGIN
    FOR rec IN
        SELECT
            m.id AS m_id, m.name AS m_name, m.store_type AS m_store_type,
            m.lat AS m_lat, m.lng AS m_lng, m.address AS m_address,
            m.delivery_fee_cents AS m_delivery_fee_cents, m.minimum_order_cents AS m_minimum_order_cents,
            m.avg_delivery_minutes AS m_avg_delivery_minutes, m.cover_image_url AS m_cover_image_url,
            m.is_open AS m_is_open, m.opens_at AS m_opens_at, m.closes_at AS m_closes_at,
            ROUND(6371000 * acos(LEAST(1.0,
                cos(radians(p_lat)) * cos(radians(m.lat)) *
                cos(radians(m.lng) - radians(p_lng)) +
                sin(radians(p_lat)) * sin(radians(m.lat))
            )))::integer AS m_dist,
            promo.id AS promo_id
        FROM public.merchants m
        LEFT JOIN LATERAL (
            SELECT p.id, p.cost_per_impression_cents
            FROM public.merchant_promotions p
            WHERE p.merchant_id = m.id
              AND p.promotion_type IN ('home_featured', 'search_boost')
              AND p.is_active = true
              AND current_date BETWEEN p.start_date AND p.end_date
              AND p.spent_cents + p.cost_per_impression_cents <= p.budget_cents
            ORDER BY p.cost_per_impression_cents DESC
            LIMIT 1
        ) promo ON true
        WHERE m.is_active = true
          AND m.activation_status = 'active'
          AND m.store_type = p_store_type
          AND m.lat IS NOT NULL AND m.lng IS NOT NULL
          AND 6371 * acos(LEAST(1.0,
                cos(radians(p_lat)) * cos(radians(m.lat)) *
                cos(radians(m.lng) - radians(p_lng)) +
                sin(radians(p_lat)) * sin(radians(m.lat))
              )) <= p_radius_km
        ORDER BY (promo.id IS NOT NULL) DESC, m_dist ASC
    LOOP
        IF rec.promo_id IS NOT NULL AND v_uid IS NOT NULL THEN
            PERFORM public.charge_promotion_impression(rec.promo_id, v_uid);
        END IF;

        id := rec.m_id; name := rec.m_name; store_type := rec.m_store_type;
        lat := rec.m_lat; lng := rec.m_lng; address := rec.m_address;
        delivery_fee_cents := rec.m_delivery_fee_cents; minimum_order_cents := rec.m_minimum_order_cents;
        avg_delivery_minutes := rec.m_avg_delivery_minutes; cover_image_url := rec.m_cover_image_url;
        is_open := rec.m_is_open; opens_at := rec.m_opens_at; closes_at := rec.m_closes_at;
        distance_meters := rec.m_dist; is_promoted := (rec.promo_id IS NOT NULL);
        RETURN NEXT;
    END LOOP;
    RETURN;
END;
$$;

-- DROP FUNCTION wipes prior GRANTs — restore the same access this
-- function already had (HomeScreen.tsx calls it directly as a rider).
GRANT EXECUTE ON FUNCTION "public"."get_nearby_merchants"(double precision, double precision, double precision, "text") TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
