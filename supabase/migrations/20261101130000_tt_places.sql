-- Our own list of Trinidad and Tobago's roads and places, so a rider can find
-- a road or business by name. Mapbox found 1 of 22 common T&T names when tested
-- 2026-11-01; OpenStreetMap had 45 of 50. Built by scripts/build_tt_places.py
-- from an Overpass export and loaded from supabase/data/tt_places.csv.
-- Data (c) OpenStreetMap contributors, ODbL: credit it in the app.
--
-- Read-only reference data. Riders reach it only through the geocode function.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.tt_places (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        text NOT NULL,
    kind        text NOT NULL CHECK (kind IN ('road', 'place', 'poi')),
    category    text,
    area        text,
    aliases     text,
    lat         double precision NOT NULL,
    lng         double precision NOT NULL,
    search_text text GENERATED ALWAYS AS (
        regexp_replace(replace(lower(name || ' ' || replace(COALESCE(aliases, ''), ';', ' ')), '''', ''), '[^a-z0-9 ]', ' ', 'g')
    ) STORED
);

CREATE INDEX IF NOT EXISTS tt_places_search ON public.tt_places USING gin (search_text extensions.gin_trgm_ops);

ALTER TABLE public.tt_places ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tt_places FROM anon, authenticated;

-- Exact name, then starts-with, then contains, then close spelling. Near the
-- rider wins ties, and a long road shows once per town.
CREATE OR REPLACE FUNCTION public.search_tt_places(
    p_query text, p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL, p_limit integer DEFAULT 8
)
RETURNS TABLE(id bigint, name text, kind text, category text, area text, lat double precision, lng double precision, score numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
    WITH q AS (
        SELECT btrim(regexp_replace(replace(lower(p_query), '''', ''), '[^a-z0-9 ]', ' ', 'g')) AS t
    ), hits AS (
        SELECT p.*, q.t,
            (CASE WHEN q.t = ANY (string_to_array(lower(COALESCE(p.aliases, '')), ';')) THEN 130
                  WHEN regexp_replace(replace(lower(p.name), '''', ''), '[^a-z0-9 ]', ' ', 'g') = q.t THEN 100
                  WHEN p.search_text LIKE q.t || '%' THEN 80
                  WHEN p.search_text LIKE '%' || q.t || '%' THEN 60
                  ELSE (word_similarity(q.t, p.search_text) * 50)::int END
             + CASE p.kind WHEN 'place' THEN 6 WHEN 'road' THEN 4 ELSE 0 END
             + CASE WHEN p_lat IS NULL OR p_lng IS NULL THEN 0
                    ELSE GREATEST(0, 15 - sqrt(power(p.lat - p_lat, 2) + power(p.lng - p_lng, 2)) * 111 / 3) END
            )::numeric AS s
          FROM public.tt_places p, q
         WHERE char_length(q.t) >= 2
           AND (p.search_text LIKE '%' || q.t || '%' OR word_similarity(q.t, p.search_text) >= 0.5)
    ), one_per_town AS (
        SELECT DISTINCT ON (lower(h.name), COALESCE(h.area, '')) h.*
          FROM hits h
         ORDER BY lower(h.name), COALESCE(h.area, ''), h.s DESC
    )
    SELECT o.id, o.name, o.kind, o.category, o.area, o.lat, o.lng, o.s
      FROM one_per_town o
     ORDER BY o.s DESC, char_length(o.name) ASC
     LIMIT LEAST(GREATEST(p_limit, 1), 20);
$function$;

REVOKE ALL ON FUNCTION public.search_tt_places(text, double precision, double precision, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_tt_places(text, double precision, double precision, integer) TO service_role;
