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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAPBOX_TOKEN = Deno.env.get("MAPBOX_ACCESS_TOKEN") || Deno.env.get("MAPBOX_PUBLIC_TOKEN") || "";
const TT_BBOX = "bbox=-61.9311,10.0280,-60.5423,10.8421";

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
    source?: "verified_pins" | "mapbox";
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
            `access_token=${MAPBOX_TOKEN}&country=TT&${TT_BBOX}${proximity}&types=address,poi,place,neighborhood&limit=${limit}`;
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

        const { query, limit = 20, lat, lng } = body;
        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // If lat/lng provided, return nearest verified pins sorted by distance
        if (lat && lng && typeof lat === 'number' && typeof lng === 'number') {
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
        const mapboxResults = await mapboxSearch(sanitizedQuery, lat, lng, limit);
        const combined = [...verifiedCombined, ...mapboxResults];

        return new Response(
            JSON.stringify({
                success: true,
                data: combined.slice(0, limit),
                source: mapboxResults.length ? "verified_pins+mapbox" : "verified_pins",
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