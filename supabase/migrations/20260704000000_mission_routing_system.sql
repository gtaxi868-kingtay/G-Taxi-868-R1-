-- Mission-Based Routing System
-- ==============================
-- NOTE: tables/functions in sections 1-9 already existed live in production
-- before this file was written (applied directly, migration never committed —
-- see project_db_source_of_truth memory on DB/git drift). This file is kept
-- as the source-of-truth record of that schema, plus the lockdown fixes in
-- section 10 which were verified NOT yet applied and were applied by this
-- session on 2026-07-04.
--
-- 1. safe_zones: user-designated safe locations with geography
-- 2. rider_route_patterns: ML-learning of rider merchant stop habits
-- 3. trust_networks + trust_network_members: referral-based trust
-- 4. referral_codes.trust_network_id
-- 5. Trigger: trg_record_rider_pattern
-- 6. user_documents: KYC proof-of-address for safe-zone verification
-- 7. safe_zones verification columns
-- 8. profiles.referral_source_driver_id
-- 9. create_driver_referral_network RPC
-- 10. Lockdown: RLS self-verification bypass + EXECUTE grants

-- ============================================================
-- 1. SAFE ZONES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.safe_zones (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name text NOT NULL,
    location geography(POINT, 4326) NOT NULL,
    radius_meters smallint DEFAULT 100 NOT NULL,
    is_home boolean DEFAULT false,
    is_work boolean DEFAULT false,
    trust_weight smallint DEFAULT 10,
    created_at timestamptz DEFAULT now(),

    UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_safe_zones_location ON public.safe_zones USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_safe_zones_user_id ON public.safe_zones (user_id);

ALTER TABLE public.safe_zones ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. RIDER ROUTE PATTERNS (learning engine)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rider_route_patterns (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    rider_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    origin_zone text NOT NULL,
    destination_zone text NOT NULL,
    typical_merchant_id uuid REFERENCES public.merchants(id) ON DELETE SET NULL,
    probability numeric(4,3) DEFAULT 0,
    sample_size smallint DEFAULT 0,
    time_window text[],
    last_observed_at timestamptz DEFAULT now(),
    created_at timestamptz DEFAULT now(),

    UNIQUE(rider_id, origin_zone, destination_zone, typical_merchant_id)
);

CREATE INDEX IF NOT EXISTS idx_rider_route_patterns_rider ON public.rider_route_patterns (rider_id);
CREATE INDEX IF NOT EXISTS idx_rider_route_patterns_zones ON public.rider_route_patterns (origin_zone, destination_zone);

-- Helper function: coords to ~110m grid zone
CREATE OR REPLACE FUNCTION public.coords_to_zone(lat double precision, lng double precision)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
    SELECT ROUND(lat::numeric, 3)::text || ',' || ROUND(lng::numeric, 3)::text;
$$;

-- Trigger: record rider stop pattern when a merchant stop is completed
CREATE OR REPLACE FUNCTION public.trg_record_rider_pattern()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_rider_id uuid;
    v_origin_zone text;
    v_destination_zone text;
    v_total_trips integer;
BEGIN
    IF NEW.stop_type = 'merchant' AND NEW.status = 'completed' THEN
        SELECT rider_id, coords_to_zone(pickup_lat, pickup_lng), coords_to_zone(dropoff_lat, dropoff_lng)
        INTO v_rider_id, v_origin_zone, v_destination_zone
        FROM public.rides
        WHERE id = NEW.ride_id;

        IF v_rider_id IS NOT NULL THEN
            -- Count total trips on this route
            SELECT COUNT(*) INTO v_total_trips
            FROM public.rides
            WHERE rider_id = v_rider_id
              AND coords_to_zone(pickup_lat, pickup_lng) = v_origin_zone
              AND coords_to_zone(dropoff_lat, dropoff_lng) = v_destination_zone;

            INSERT INTO public.rider_route_patterns (
                rider_id, origin_zone, destination_zone,
                typical_merchant_id, probability, sample_size,
                time_window, last_observed_at
            ) VALUES (
                v_rider_id, v_origin_zone, v_destination_zone,
                (SELECT m.id FROM public.merchants m
                 WHERE m.lat IS NOT NULL AND m.lng IS NOT NULL
                 ORDER BY m.lat <-> NEW.lat, m.lng <-> NEW.lng LIMIT 1),
                LEAST(1.0, (SELECT COUNT(*) + 1 FROM public.ride_stops
                            WHERE ride_id IN (
                                SELECT id FROM public.rides
                                WHERE rider_id = v_rider_id
                                  AND coords_to_zone(pickup_lat, pickup_lng) = v_origin_zone
                                  AND coords_to_zone(dropoff_lat, dropoff_lng) = v_destination_zone
                            )
                            AND stop_type = 'merchant' AND status = 'completed')::numeric / GREATEST(v_total_trips, 1)),
                1,
                ARRAY[to_char(NEW.created_at, 'HH24:MI') || '-' || to_char(NEW.created_at + interval '2 hours', 'HH24:MI'),
                      CASE WHEN EXTRACT(DOW FROM NEW.created_at) BETWEEN 1 AND 5 THEN 'weekday' ELSE 'weekend' END],
                NEW.created_at
            )
            ON CONFLICT (rider_id, origin_zone, destination_zone, typical_merchant_id)
            DO UPDATE SET
                sample_size = rider_route_patterns.sample_size + 1,
                probability = LEAST(1.0, (rider_route_patterns.sample_size + 1)::numeric / GREATEST(v_total_trips, 1)),
                last_observed_at = NEW.created_at,
                time_window = CASE
                    WHEN NOT (to_char(NEW.created_at, 'HH24:MI') || '-' || to_char(NEW.created_at + interval '2 hours', 'HH24:MI') = ANY(rider_route_patterns.time_window))
                    THEN rider_route_patterns.time_window || to_char(NEW.created_at, 'HH24:MI') || '-' || to_char(NEW.created_at + interval '2 hours', 'HH24:MI')
                    ELSE rider_route_patterns.time_window
                END;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_rider_pattern ON public.ride_stops;
CREATE TRIGGER trg_record_rider_pattern
    AFTER INSERT OR UPDATE OF status ON public.ride_stops
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_record_rider_pattern();

-- ============================================================
-- 3. TRUST NETWORKS (referral-based safety network)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.trust_networks (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text DEFAULT 'Personal Network',
    created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    member_count smallint DEFAULT 1,
    trust_bonus smallint DEFAULT 5,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trust_networks_created_by ON public.trust_networks (created_by);

ALTER TABLE public.trust_networks ENABLE ROW LEVEL SECURITY;

CREATE POLICY trust_networks_member_select ON public.trust_networks
    FOR SELECT
    USING (
        created_by = auth.uid()
        OR id IN (SELECT network_id FROM public.trust_network_members WHERE user_id = auth.uid())
    );

CREATE POLICY trust_networks_insert ON public.trust_networks
    FOR INSERT
    WITH CHECK (created_by = auth.uid());

CREATE TABLE IF NOT EXISTS public.trust_network_members (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    network_id uuid NOT NULL REFERENCES public.trust_networks(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role text DEFAULT 'member',
    joined_at timestamptz DEFAULT now(),

    UNIQUE(network_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_trust_network_members_network ON public.trust_network_members (network_id);
CREATE INDEX IF NOT EXISTS idx_trust_network_members_user ON public.trust_network_members (user_id);

ALTER TABLE public.trust_network_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY trust_network_members_select ON public.trust_network_members
    FOR SELECT
    USING (
        user_id = auth.uid()
        OR network_id IN (
            SELECT id FROM public.trust_networks WHERE created_by = auth.uid()
        )
    );

CREATE POLICY trust_network_members_insert ON public.trust_network_members
    FOR INSERT
    WITH CHECK (
        network_id IN (SELECT id FROM public.trust_networks WHERE created_by = auth.uid())
    );

-- Add trust_network_id to referral_codes
ALTER TABLE public.referral_codes ADD COLUMN IF NOT EXISTS trust_network_id uuid REFERENCES public.trust_networks(id) ON DELETE SET NULL;

-- ============================================================
-- 4. TRUST SCORE CALCULATION FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.calculate_ride_trust_score(
    p_rider_id uuid,
    p_pickup_lat double precision,
    p_pickup_lng double precision,
    p_dropoff_lat double precision,
    p_dropoff_lng double precision,
    p_route_polyline text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_score integer := 100;
    v_intersections integer := 0;
    v_home_zone boolean := false;
    v_work_zone boolean := false;
    v_badge text := '';
    v_route_geom geography;
    v_pickup_geom geography;
    v_dropoff_geom geography;
    v_zone_record record;
BEGIN
    v_pickup_geom := ST_SetSRID(ST_MakePoint(p_pickup_lng, p_pickup_lat), 4326)::geography;
    v_dropoff_geom := ST_SetSRID(ST_MakePoint(p_dropoff_lng, p_dropoff_lat), 4326)::geography;

    -- Check each safe zone
    FOR v_zone_record IN
        SELECT * FROM public.safe_zones WHERE user_id = p_rider_id
    LOOP
        -- Check if pickup is near home
        IF v_zone_record.is_home AND ST_DWithin(v_pickup_geom, v_zone_record.location, v_zone_record.radius_meters) THEN
            v_score := v_score + 15;
            v_home_zone := true;
        END IF;

        -- Check if dropoff is near work
        IF v_zone_record.is_work AND ST_DWithin(v_dropoff_geom, v_zone_record.location, v_zone_record.radius_meters) THEN
            v_score := v_score + 10;
            v_work_zone := true;
        END IF;

        -- Check if route passes through any safe zone (using pickup/dropoff proximity as proxy)
        IF ST_DWithin(v_pickup_geom, v_zone_record.location, v_zone_record.radius_meters * 3)
           OR ST_DWithin(v_dropoff_geom, v_zone_record.location, v_zone_record.radius_meters * 3) THEN
            v_score := v_score + v_zone_record.trust_weight;
            v_intersections := v_intersections + 1;
        END IF;
    END LOOP;

    -- Clamp
    v_score := GREATEST(0, LEAST(100, v_score));

    -- Badge assignment
    IF v_intersections >= 3 AND v_score >= 50 THEN
        v_badge := 'VERIFIED_SAFE';
    ELSIF v_score >= 30 THEN
        v_badge := 'SAFE_ROUTE';
    ELSE
        v_badge := 'STANDARD';
    END IF;

    RETURN jsonb_build_object(
        'score', v_score,
        'badge', v_badge,
        'intersections', v_intersections,
        'home_zone_pickup', v_home_zone,
        'work_zone_dropoff', v_work_zone
    );
END;
$$;

-- ============================================================
-- 5. NEARBY MERCHANTS FUNCTION (for rider map pins)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_nearby_merchants_for_route(
    p_pickup_lat double precision,
    p_pickup_lng double precision,
    p_dropoff_lat double precision,
    p_dropoff_lng double precision,
    p_radius_km double precision DEFAULT 5
)
RETURNS jsonb[]
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_mid_lat double precision := (p_pickup_lat + p_dropoff_lat) / 2;
    v_mid_lng double precision := (p_pickup_lng + p_dropoff_lng) / 2;
    v_result jsonb[];
BEGIN
    SELECT array_agg(
        jsonb_build_object(
            'id', m.id,
            'name', m.name,
            'category', m.category,
            'lat', m.lat,
            'lng', m.lng,
            'address', m.address,
            'is_open', m.is_open,
            'cover_image_url', m.cover_image_url,
            'distance_km', ROUND(
                (ST_Distance(
                    ST_SetSRID(ST_MakePoint(m.lng, m.lat), 4326)::geography,
                    ST_SetSRID(ST_MakePoint(v_mid_lng, v_mid_lat), 4326)::geography
                ) / 1000)::numeric, 1
            )
        )
    ) INTO v_result
    FROM public.merchants m
    LEFT JOIN public.merchant_subscriptions ms ON ms.merchant_id = m.id
    WHERE m.is_active = true
      AND m.activation_status = 'active'
      AND m.lat IS NOT NULL AND m.lng IS NOT NULL
      AND m.is_open = true
      AND (CURRENT_TIME >= m.opens_at OR m.opens_at IS NULL)
      AND (CURRENT_TIME <= m.closes_at OR m.closes_at IS NULL)
      AND ms.status IN ('trial', 'active')
      AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(m.lng, m.lat), 4326)::geography,
          ST_SetSRID(ST_MakePoint(v_mid_lng, v_mid_lat), 4326)::geography,
          p_radius_km * 1000
      )
    ORDER BY ST_Distance(
        ST_SetSRID(ST_MakePoint(m.lng, m.lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(v_mid_lng, v_mid_lat), 4326)::geography
    ) ASC
    LIMIT 50;

    RETURN COALESCE(v_result, ARRAY[]::jsonb[]);
END;
$$;

-- ============================================================
-- 6. USER DOCUMENTS (KYC proof-of-address for safe-zone verification)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_documents (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    document_type text NOT NULL DEFAULT 'proof_of_address',
    file_url text,
    verified_address text,
    address_lat double precision,
    address_lng double precision,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
    reviewed_by uuid REFERENCES auth.users(id),
    reviewed_at timestamptz,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_documents_user ON public.user_documents (user_id);

ALTER TABLE public.user_documents ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 7. SAFE ZONES: verification columns (create_safe_zone edge fn needs these)
-- ============================================================
ALTER TABLE public.safe_zones
ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'verified', 'rejected')),
ADD COLUMN IF NOT EXISTS geocoded_address text,
ADD COLUMN IF NOT EXISTS verified_document_id uuid REFERENCES public.user_documents(id) ON DELETE SET NULL;

-- ============================================================
-- 8. DRIVER REFERRAL LINK (profiles.referral_source_driver_id)
-- ============================================================
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS referral_source_driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_referral_source_driver ON public.profiles (referral_source_driver_id);

-- ============================================================
-- 9. CREATE DRIVER REFERRAL NETWORK (atomic dual-link for referral_driver_signup)
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_driver_referral_network(p_rider_id uuid, p_driver_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_driver_user_id uuid;
    v_network_id uuid;
    v_referral_code_id uuid;
BEGIN
    -- Get the driver's auth user id
    SELECT user_id INTO v_driver_user_id
    FROM public.drivers
    WHERE id = p_driver_id;

    IF v_driver_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Driver not found');
    END IF;

    -- Create or reuse driver's personal trust network
    INSERT INTO public.trust_networks (name, created_by, member_count, trust_bonus)
    VALUES ('Driver: ' || p_driver_id::text, v_driver_user_id, 1, 10)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_network_id;

    -- If network already existed, find it
    IF v_network_id IS NULL THEN
        SELECT id INTO v_network_id
        FROM public.trust_networks
        WHERE created_by = v_driver_user_id
        ORDER BY created_at DESC
        LIMIT 1;
    END IF;

    -- Add rider as member
    INSERT INTO public.trust_network_members (network_id, user_id, role)
    VALUES (v_network_id, p_rider_id, 'referral_rider')
    ON CONFLICT (network_id, user_id) DO NOTHING;

    -- Update member count
    UPDATE public.trust_networks
    SET member_count = (SELECT COUNT(*) FROM public.trust_network_members WHERE network_id = v_network_id)
    WHERE id = v_network_id;

    -- Update rider's profile to mark referral source
    UPDATE public.profiles
    SET referral_source_driver_id = p_driver_id
    WHERE id = p_rider_id;

    -- Find and update referral code usage if it exists
    SELECT id INTO v_referral_code_id
    FROM public.referral_codes
    WHERE user_id = v_driver_user_id
      AND type = 'driver'
    LIMIT 1;

    IF v_referral_code_id IS NOT NULL THEN
        UPDATE public.referral_codes
        SET trust_network_id = v_network_id,
            uses = uses + 1
        WHERE id = v_referral_code_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'network_id', v_network_id,
        'driver_user_id', v_driver_user_id,
        'trust_bonus', 10
    );
END;
$function$;

-- ============================================================
-- 10. LOCKDOWN — closes two holes found auditing this batch (2026-07-04):
--
-- a) user_documents/safe_zones originally shipped with a single FOR ALL
--    self-policy (USING/WITH CHECK user_id = auth.uid()). That let a rider
--    directly UPDATE their own row's status/verification_status to
--    'verified' via the client SDK, completely bypassing the Mapbox
--    reverse-geocode distance check in create_safe_zone. No client code
--    touches these tables directly (edge functions use service_role), so
--    dropping self-UPDATE is safe and closes the bypass.
--
-- b) calculate_ride_trust_score / get_nearby_merchants_for_route /
--    create_driver_referral_network are SECURITY DEFINER functions meant to
--    run only via service_role from edge functions, but as originally
--    created they granted EXECUTE to PUBLIC (Postgres's default for new
--    functions) — meaning any authenticated client could call
--    calculate_ride_trust_score directly with an arbitrary p_rider_id and,
--    by sweeping lat/lng, use the home_zone_pickup/work_zone_dropoff flags
--    to triangulate a stranger's home or work address. Revoked from PUBLIC,
--    re-granted to service_role only.
-- ============================================================

DROP POLICY IF EXISTS user_documents_self ON public.user_documents;

CREATE POLICY user_documents_select_own ON public.user_documents
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY user_documents_insert_own ON public.user_documents
    FOR INSERT WITH CHECK (user_id = auth.uid() AND status = 'pending');

CREATE POLICY user_documents_delete_own ON public.user_documents
    FOR DELETE USING (user_id = auth.uid());

CREATE POLICY user_documents_admin_all ON public.user_documents
    FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS safe_zones_self ON public.safe_zones;

CREATE POLICY safe_zones_select_own ON public.safe_zones
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY safe_zones_insert_own ON public.safe_zones
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY safe_zones_delete_own ON public.safe_zones
    FOR DELETE USING (user_id = auth.uid());

REVOKE EXECUTE ON FUNCTION public.calculate_ride_trust_score(uuid, double precision, double precision, double precision, double precision, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_nearby_merchants_for_route(double precision, double precision, double precision, double precision, double precision) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_driver_referral_network(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.calculate_ride_trust_score(uuid, double precision, double precision, double precision, double precision, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_nearby_merchants_for_route(double precision, double precision, double precision, double precision, double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_driver_referral_network(uuid, uuid) TO service_role;
