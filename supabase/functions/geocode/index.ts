// Supabase Edge Function: geocode
//
// Was: "Zero Unverified Addresses" — only returned verified merchant pins,
// kiosk nodes, and pre-mapped locations. No freeform geocoding, no
// Nominatim/OSM fallback. That closed real fraud vectors (see
// verify_kiosk_origin in create_ride), but the address search itself never
// touched those vectors — it only ever produces a lat/lng for the rider to
// confirm, the same as typing a pin. Fare, dispatch, and kiosk-commission
// attribution are verified independently server-side regardless of how a
// coordinate was chosen (create_ride's verify_kiosk_origin, geofence, or a
// real NFC tap) — none of them trust this function's output for anything
// but "where is this point."
//
// So: real street/address matches now come from Mapbox's Geocoding API,
// the same paid, licensed provider that already renders the map itself and
// already resolves addresses for parse_natural_language, suggest_stops,
// create_ride's routing, and estimate_fare. That is meaningfully different
// from "freeform Nominatim" — it is verified against Mapbox's own address
// database, not accepted as arbitrary user-typed text. Bounded to Trinidad
// & Tobago via TT_BBOX, same constant as parse_natural_language.
//
// Verified merchant pins and pre-mapped locations still come first and are
// labeled distinctly (source: "verified_pins") from Mapbox address matches
// (source: "mapbox") — a rider can tell an admin-curated pin from a plain
// street-address match, but is no longer stuck when their destination is
// neither.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { secureFetch } from "../_shared/networkUtility.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAPBOX_TOKEN = Deno.env.get("MAPBOX_ACCESS_TOKEN") || Deno.env.get("MAPBOX_PUBLIC_TOKEN") || "";
// Google Places (New), server key. Optional: without it search uses Mapbox
// only. Tested 2026-10-18: Mapbox found 3 of 8 common T&T places (towns
// only; missed Maraval, Trincity Mall, Piarco Airport, UWI).
const GOOGLE_PLACES_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") || "";
// Covers BOTH islands. The old box stopped at latitude 10.84, which is
// north of Trinidad but south of Tobago (Scarborough is ~11.19), so every
// Tobago address was silently dropped from search (verified 2026-10-15).
const TT_BBOX = "bbox=-61.95,9.95,-60.45,11.40";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PinnedResult {
    id: string;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    category: string;
    source?: "verified_pins" | "mapbox" | "google";
}

// Real street/address/POI matches from Mapbox, bounded to T&T. Graceful
// degrade to an empty array on any failure or missing token — this must
// never be the reason a search fails, only ever an addition on top of
// verified pins (matching the project's existing MAPBOX_TOKEN convention).
async function mapboxSearch(query: string, lat?: number, lng?: number, limit = 6): Promise<PinnedResult[]> {
    if (!MAPBOX_TOKEN || !query) return [];
    try {
        const proximity = (typeof lat === "number" && typeof lng === "number")
            ? `&proximity=${lng},${lat}` : "";
        const url =
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?` +
            `access_token=${MAPBOX_TOKEN}&country=TT&${TT_BBOX}${proximity}&types=address,poi,place,locality,neighborhood,district&limit=${limit}`;
        const res = await secureFetch(url);
        if (!res.ok) return [];
        const json = await res.json();
        const features = Array.isArray(json?.features) ? json.features : [];
        return features
            .filter((f: any) => Array.isArray(f?.geometry?.coordinates))
            .map((f: any) => ({
                id: "mapbox_" + f.id,
                name: (f.text as string) || (f.place_name as string) || query,
                address: f.place_name as string,
                latitude: f.geometry.coordinates[1],
                longitude: f.geometry.coordinates[0],
                category: (f.place_type?.[0] as string) || "address",
                source: "mapbox" as const,
            }));
    } catch (err) {
        console.error("[geocode] Mapbox search failed (non-fatal):", err);
        return [];
    }
}

// Every Google call is billed, so it sits behind three limits (code review
// 2026-10-18): the shared per-user geocode limit on every text search, a
// per-user daily Google allowance, and a whole-project daily Google cap
// (GOOGLE_PLACES_DAILY_CAP, default 300). Past either Google limit, search
// quietly falls back to Mapbox. Repeat searches are answered from a short
// in-memory cache and never reach Google.
const GOOGLE_DAILY_CAP = Number(Deno.env.get("GOOGLE_PLACES_DAILY_CAP") || "300");
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;
const placesCache = new Map<string, { at: number; results: PinnedResult[] }>();

// Only .rpc() is used; typed structurally so any supabase-js version fits
// (same approach as _shared/rateLimit.ts).
type RpcClient = {
    rpc(fn: string, params?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const inTT = (la: number, ln: number) => la >= 9.95 && la <= 11.40 && ln >= -61.95 && ln <= -60.45;

async function googleAllowed(admin: RpcClient, userId: string): Promise<boolean> {
    try {
        const user = await checkRateLimit(admin, `google_places_user_${userId}`, "geocode_google_user");
        if (!user.allowed) return false;
        const project = await admin.rpc("check_rate_limit", {
            p_user_id: "00000000-0000-4000-8000-000000000868",
            p_endpoint: "geocode_google_project",
            p_max_requests: GOOGLE_DAILY_CAP,
            p_window_seconds: 86400,
        });
        return !project.error && project.data === true;
    } catch {
        return false;
    }
}

// Google Places Text Search for Trinidad and Tobago. With the rider's
// position it ranks nearby places first (locationBias; the API allows bias
// OR restriction, not both), and results outside T&T are dropped in code.
// Returns [] on any failure so it can never break search.
async function googleSearch(query: string, lat?: number, lng?: number, limit = 6): Promise<PinnedResult[]> {
    if (!GOOGLE_PLACES_KEY || !query) return [];
    try {
        const body: Record<string, unknown> = {
            textQuery: query,
            regionCode: "TT",
            maxResultCount: Math.min(Math.max(limit, 1), 20),
        };
        if (typeof lat === "number" && typeof lng === "number" && inTT(lat, lng)) {
            body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 50000 } };
        } else {
            body.locationRestriction = { rectangle: { low: { latitude: 9.95, longitude: -61.95 }, high: { latitude: 11.40, longitude: -60.45 } } };
        }
        const res = await secureFetch("https://places.googleapis.com/v1/places:searchText", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": GOOGLE_PLACES_KEY,
                "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.primaryType",
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            console.error("[geocode] Google Places HTTP", res.status);
            return [];
        }
        const json = await res.json();
        const places = Array.isArray(json?.places) ? json.places : [];
        return places
            .filter((p: any) => typeof p?.location?.latitude === "number" && inTT(p.location.latitude, p.location.longitude))
            .map((p: any) => ({
                id: "google_" + p.id,
                name: (p.displayName?.text as string) || query,
                address: (p.formattedAddress as string) || (p.displayName?.text as string) || query,
                latitude: p.location.latitude,
                longitude: p.location.longitude,
                category: (p.primaryType as string) || "place",
                source: "google" as const,
            }));
    } catch (err) {
        console.error("[geocode] Google Places search failed (non-fatal):", err);
        return [];
    }
}

// Best available provider first: Google when configured and within its
// limits, Mapbox otherwise or when Google returns nothing. Results are cached
// per query and rough area (~1 km) for 10 minutes.
async function placesSearch(
    admin: RpcClient, userId: string,
    query: string, lat?: number, lng?: number, limit = 6,
): Promise<PinnedResult[]> {
    const hasPos = typeof lat === "number" && typeof lng === "number";
    const key = `${query.toLowerCase().replace(/\s+/g, " ").trim()}|${limit}|${hasPos ? `${lat!.toFixed(2)},${lng!.toFixed(2)}` : "-"}`;
    const hit = placesCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.results;

    let results: PinnedResult[] = [];
    if (GOOGLE_PLACES_KEY && await googleAllowed(admin, userId)) {
        results = await googleSearch(query, lat, lng, limit);
    }
    if (results.length === 0) results = await mapboxSearch(query, lat, lng, limit);

    if (results.length > 0) {
        if (placesCache.size >= CACHE_MAX) placesCache.delete(placesCache.keys().next().value!);
        placesCache.set(key, { at: Date.now(), results });
    }
    return results;
}

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
            global: { headers: { Authorization: authHeader ?? '' } },
        });
        const { data: { user }, error: authError } = await anonClient.auth.getUser();
        if (authError || !user) {
            return new Response(
                JSON.stringify({ success: false, error: 'Unauthorized: Valid JWT required', data: [] }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        let body;
        try {
            body = await req.json();
        } catch {
            return new Response(
                JSON.stringify({ success: false, error: "Invalid JSON", data: [] }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const { query, limit = 20, lat, lng, address } = body;
        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const hasQuery = typeof query === "string" && query.trim().length > 0;

        // Text searches and address lookups reach paid map providers, so they
        // count against the shared geocode limit (20 a minute per user).
        if (hasQuery || (typeof address === "string" && address.trim())) {
            const limited = await checkRateLimit(adminClient, user.id, "geocode");
            if (!limited.allowed) {
                return new Response(
                    JSON.stringify({ success: false, error: "Too many searches. Wait a moment and try again.", data: [] }),
                    { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
        }

        // Single-address lookup: HomeScreen's "Save Home/Work" sends
        // { address } and reads latitude/longitude off the top of the
        // response. This function never handled that shape -- it fell through
        // to the "no query" branch and returned a pin list -- so saving a place
        // ALWAYS showed "Could not find address" (verified 2026-10-15).
        if (typeof address === "string" && address.trim() && !query) {
            const [best] = await placesSearch(adminClient, user.id, address.trim(), undefined, undefined, 1);
            if (!best) {
                return new Response(
                    JSON.stringify({ success: false, error: "Address not found", data: [] }),
                    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            return new Response(
                JSON.stringify({
                    success: true,
                    latitude: best.latitude,
                    longitude: best.longitude,
                    address: best.address,
                    data: [best],
                    source: best.source ?? "mapbox",
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Position only (no text): return nearest verified pins sorted by
        // distance. With text, the position is used to rank results instead.
        if (!hasQuery && lat && lng && typeof lat === 'number' && typeof lng === 'number') {
            const { data: nearbyPins } = await adminClient
                .rpc('nearest_verified_pin', {
                    p_lat: lat,
                    p_lng: lng,
                    p_max_results: limit,
                });

            return new Response(
                JSON.stringify({
                    success: true,
                    data: (nearbyPins || []).map((p: any) => ({
                        id: p.id,
                        name: p.name,
                        address: p.address || p.name,
                        latitude: p.latitude,
                        longitude: p.longitude,
                        category: p.category || 'merchant',
                        distance_meters: Math.round(p.distance_meters),
                    })),
                    source: "verified_pins",
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Text query mode: search merchants and locations by name/address
        if (!query || typeof query !== "string" || query.length < 1) {
            // No query and no lat/lng — return popular verified pins
            const { data: allPins } = await adminClient
                .from("merchants")
                .select("id, name, address, lat, lng, category")
                .eq("is_pinned", true)
                .eq("is_active", true)
                .limit(limit);

            const { data: locations } = await adminClient
                .from("locations")
                .select("id, name, address, latitude, longitude, category")
                .limit(limit);

            const combined: PinnedResult[] = [
                ...(allPins || []).map(m => ({
                    id: 'merchant_' + m.id,
                    name: m.name,
                    address: m.address || m.name,
                    latitude: m.lat,
                    longitude: m.lng,
                    category: m.category || 'merchant',
                })),
                ...(locations || []).map(l => ({
                    id: 'location_' + l.id,
                    name: l.name,
                    address: l.address || l.name,
                    latitude: l.latitude,
                    longitude: l.longitude,
                    category: l.category || 'landmark',
                })),
            ];

            return new Response(
                JSON.stringify({ success: true, data: combined.slice(0, limit), source: "verified_pins" }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const sanitizedQuery = query.replace(/[(),."'\\%;]/g, '').trim();
        if (!sanitizedQuery || sanitizedQuery.length < 1) {
            return new Response(
                JSON.stringify({ success: false, error: "Invalid query", data: [] }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Search verified merchants by name
        const { data: merchantResults } = await adminClient
            .from("merchants")
            .select("id, name, address, lat, lng, category")
            .eq("is_pinned", true)
            .eq("is_active", true)
            .or(`name.ilike.%${sanitizedQuery}%,address.ilike.%${sanitizedQuery}%`)
            .limit(limit);

        // Search pre-mapped locations
        const { data: locationResults } = await adminClient
            .from("locations")
            .select("id, name, address, latitude, longitude, category")
            .or(`name.ilike.%${sanitizedQuery}%,address.ilike.%${sanitizedQuery}%`)
            .limit(limit);

        const formattedMerchants: PinnedResult[] = (merchantResults || []).map(m => ({
            id: 'merchant_' + m.id,
            name: m.name,
            address: m.address || m.name,
            latitude: m.lat,
            longitude: m.lng,
            category: m.category || 'merchant',
            source: 'verified_pins',
        }));

        const formattedLocations: PinnedResult[] = (locationResults || []).map(l => ({
            id: 'location_' + l.id,
            name: l.name,
            address: l.address || l.name,
            latitude: l.latitude,
            longitude: l.longitude,
            category: l.category || 'landmark',
            source: 'verified_pins',
        }));

        // Verified pins first (admin-curated, always shown when they match),
        // then real Mapbox street/address/POI matches — this is what actually
        // closes the "my address isn't a merchant pin" dead end. Deduping on
        // near-identical coordinates would need a distance check; skipped for
        // now since verified pins and Mapbox results are visually labeled
        // (`source`) and a rider can tell them apart in the list.
        const verifiedCombined = [...formattedMerchants, ...formattedLocations];
        const mapboxResults = await placesSearch(adminClient, user.id, sanitizedQuery,
            typeof lat === 'number' ? lat : undefined, typeof lng === 'number' ? lng : undefined, limit);
        const combined = [...verifiedCombined, ...mapboxResults];

        return new Response(
            JSON.stringify({
                success: true,
                data: combined.slice(0, limit),
                source: mapboxResults.length ? `verified_pins+${mapboxResults[0].source ?? "mapbox"}` : "verified_pins",
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("Geocode error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error", data: [] }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});