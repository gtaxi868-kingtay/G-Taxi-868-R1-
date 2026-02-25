// Supabase Edge Function: geocode
// REBUILT - Clean implementation for location search
//
// Searches local database first, falls back to Mapbox for unknown locations.
// Public endpoint - no auth required (read-only location data)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAPBOX_TOKEN = Deno.env.get("MAPBOX_ACCESS_TOKEN") || "";

// Trinidad bounding box
const TRINIDAD_BBOX = "-62.0,9.8,-60.0,11.5";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LocationResult {
    id: string;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    category: string;
}

serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        // Parse request body
        let body;
        try {
            body = await req.json();
        } catch {
            return new Response(
                JSON.stringify({ success: false, error: "Invalid JSON", data: [] }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const { query, limit = 10 } = body;

        if (!query || typeof query !== "string" || query.length < 2) {
            return new Response(
                JSON.stringify({ success: false, error: "Query too short", data: [] }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        console.log("Searching for:", query);

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // Search local database first
        const { data: localResults, error: dbError } = await supabase
            .from("locations")
            .select("id, name, address, latitude, longitude, category, popularity_score")
            .or(`name.ilike.%${query}%,address.ilike.%${query}%`)
            .order("popularity_score", { ascending: false })
            .limit(limit);

        if (dbError) {
            console.error("DB error:", dbError);
        }

        const formattedLocal: LocationResult[] = (localResults || []).map((r) => ({
            id: r.id,
            name: r.name,
            address: r.address,
            latitude: r.latitude,
            longitude: r.longitude,
            category: r.category || "other",
        }));

        console.log("Local results:", formattedLocal.length);

        // Use Nominatim (OpenStreetMap) for better T&T coverage Instead of Mapbox
        try {
            const encodedQuery = encodeURIComponent(query);
            // Limit to Trinidad and Tobago (tt)
            const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodedQuery}&countrycodes=tt&format=json&limit=${limit}`;

            const nominatimResponse = await fetch(nominatimUrl, {
                headers: {
                    'User-Agent': 'GTaxi-RiderApp/1.0' // Required by Nominatim Policy
                }
            });

            const nominatimData = await nominatimResponse.json();

            if (Array.isArray(nominatimData) && nominatimData.length > 0) {
                const extResults: LocationResult[] = nominatimData.map((f: any) => ({
                    id: f.place_id.toString(),
                    name: f.name || f.display_name.split(",")[0],
                    address: f.display_name,
                    latitude: parseFloat(f.lat),
                    longitude: parseFloat(f.lon),
                    category: f.class || "location",
                }));

                // Combine local + Nominatim, remove duplicates by name
                const combined: LocationResult[] = [...formattedLocal];
                const seenNames = new Set(formattedLocal.map(r => r.name.toLowerCase()));

                for (const r of extResults) {
                    if (!seenNames.has(r.name.toLowerCase())) {
                        combined.push(r);
                        seenNames.add(r.name.toLowerCase());
                    }
                }

                console.log("Combined results:", combined.length);

                return new Response(
                    JSON.stringify({ success: true, data: combined.slice(0, limit), source: "hybrid" }),
                    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
        } catch (extError) {
            console.error("Nominatim error:", extError);
        }

        // Return whatever local results we have if Nominatim fails or has no results
        return new Response(
            JSON.stringify({ success: true, data: formattedLocal.slice(0, limit), source: "local" }),
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
