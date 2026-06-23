// Supabase Edge Function: geocode
// P0: Zero Unverified Addresses — only returns verified merchant pins, kiosk nodes, and pre-mapped locations
// No freeform geocoding. No Nominatim/OSM fallback.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
        }));

        const formattedLocations: PinnedResult[] = (locationResults || []).map(l => ({
            id: 'location_' + l.id,
            name: l.name,
            address: l.address || l.name,
            latitude: l.latitude,
            longitude: l.longitude,
            category: l.category || 'landmark',
        }));

        // Combine: merchants first, then locations
        const combined = [...formattedMerchants, ...formattedLocations];

        return new Response(
            JSON.stringify({ success: true, data: combined.slice(0, limit), source: "verified_pins" }),
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
