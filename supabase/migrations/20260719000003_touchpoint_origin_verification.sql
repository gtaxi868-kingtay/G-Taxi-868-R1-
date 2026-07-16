-- ═══════════════════════════════════════════════════════════════════
-- TOUCHPOINT-ORIGIN VERIFICATION FOR NODE RENT (2026-07-16)
--
-- create_ride set rides.vendor_node_id directly from the client-supplied
-- `kiosk_id` body param with ZERO server-side verification. Since
-- compute_ride_split pays the merchant "rent" (2% of the platform's
-- take, settlement v3) whenever vendor_node_id is set, ANY client could
-- fabricate a kiosk_id and redirect real commission revenue to an
-- arbitrary merchant — a genuine, exploitable fraud vector, found while
-- auditing the node-rent feature just built.
--
-- Fix: merchants can be credited two ways — a real NFC tap (nfc_event_logs,
-- logged by nfc_event_handler, tag_uid matched to the rider within a
-- short window) or geofence presence (pickup coords within
-- kiosk_nodes.geofence_radius_m). Node rent only applies when the origin
-- is actually verified by one of these — not trusted from the client.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.rides
    ADD COLUMN IF NOT EXISTS node_attribution_method text
        CHECK (node_attribution_method IS NULL OR node_attribution_method IN ('tap', 'geofence'));

-- Returns 'tap' | 'geofence' | NULL. Never raises — an unverifiable
-- origin means no rent, not a broken ride.
CREATE OR REPLACE FUNCTION public.verify_kiosk_origin(
    p_kiosk_id uuid,
    p_rider_id uuid,
    p_pickup_lat double precision,
    p_pickup_lng double precision
)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_tag_uid text;
    v_kiosk_lat double precision;
    v_kiosk_lng double precision;
    v_radius_m integer;
    v_dist_m double precision;
BEGIN
    IF p_kiosk_id IS NULL THEN RETURN NULL; END IF;

    SELECT tag_uid, lat, lng, geofence_radius_m
    INTO v_tag_uid, v_kiosk_lat, v_kiosk_lng, v_radius_m
    FROM public.kiosk_nodes
    WHERE id = p_kiosk_id AND is_active = true;

    IF v_tag_uid IS NULL THEN RETURN NULL; END IF;

    -- Strong path: a real tap logged against this rider + this kiosk's
    -- tag, within the last 30 minutes (long enough to cover book-now vs
    -- tap-then-browse-then-book, short enough that a tap can't be reused
    -- across unrelated later rides).
    IF EXISTS (
        SELECT 1 FROM public.nfc_event_logs
        WHERE tag_uid = v_tag_uid
          AND profile_id = p_rider_id
          AND created_at >= now() - interval '30 minutes'
    ) THEN
        RETURN 'tap';
    END IF;

    -- Fallback path: rider's pickup is physically within the kiosk's
    -- geofence. Requires both the kiosk's own coordinates and a radius
    -- to be configured — an unconfigured kiosk verifies nothing.
    IF v_kiosk_lat IS NOT NULL AND v_kiosk_lng IS NOT NULL AND v_radius_m IS NOT NULL
       AND p_pickup_lat IS NOT NULL AND p_pickup_lng IS NOT NULL THEN
        v_dist_m := 6371000 * acos(LEAST(1.0,
            cos(radians(p_pickup_lat)) * cos(radians(v_kiosk_lat)) *
            cos(radians(v_kiosk_lng) - radians(p_pickup_lng)) +
            sin(radians(p_pickup_lat)) * sin(radians(v_kiosk_lat))
        ));
        IF v_dist_m <= v_radius_m THEN
            RETURN 'geofence';
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_kiosk_origin(uuid, uuid, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_kiosk_origin(uuid, uuid, double precision, double precision) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
