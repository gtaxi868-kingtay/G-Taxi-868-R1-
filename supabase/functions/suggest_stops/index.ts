// Supabase Edge Function: suggest_stops
// FIX 2: Replaced hardcoded mock offsets with real Mapbox Places API calls.
// Returns genuine POIs (Pharmacies, Grocery Stores, Banks) along the route corridor.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { captureException } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const MAPBOX_TOKEN = Deno.env.get("MAPBOX_PUBLIC_TOKEN") ?? "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// POI categories to search, ordered by usefulness in T&T context
const STOP_CATEGORIES = [
    { category: "pharmacy",   emoji: "💊", stop_type: "pharmacy",  wait_minutes: 10 },
    { category: "grocery",    emoji: "🛒", stop_type: "grocery",   wait_minutes: 15 },
    { category: "bank",       emoji: "🏦", stop_type: "errand",    wait_minutes: 10 },
    { category: "atm",        emoji: "💵", stop_type: "errand",    wait_minutes: 5  },
    { category: "bakery",     emoji: "🥐", stop_type: "food",      wait_minutes: 8  },
];

// Midpoint between pickup and dropoff — best area to surface stops
function midpoint(lat1: number, lng1: number, lat2: number, lng2: number) {
    return { lat: (lat1 + lat2) / 2, lng: (lng1 + lng2) / 2 };
}

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: req.headers.get("Authorization")! } },
        });

        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

        if (authError || !user) {
            return new Response(
                JSON.stringify({ success: false, error: "Unauthorized" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const body = await req.json().catch(() => ({}));
        const { pickup_lat, pickup_lng, dropoff_lat, dropoff_lng } = body;

        if (!pickup_lat || !pickup_lng) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing coordinates" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Use route midpoint for search
        const { lat: searchLat, lng: searchLng } = dropoff_lat
            ? midpoint(pickup_lat, pickup_lng, dropoff_lat, dropoff_lng)
            : { lat: pickup_lat, lng: pickup_lng };

        // 1. FETCH G-TAXI NETWORK PARTNERS (Service Verticals)
        const { data: networkMerchants } = await supabaseClient
            .from("merchants")
            .select("*, user_service_history(visit_count)")
            .neq("category", "grocery")
            .neq("category", "laundry")
            .eq("is_active", true)
            .limit(10); // In prod, use PostGIS ST_DWithin(geom, ...)

        const networkSuggestions = (networkMerchants || []).map(m => ({
            place_name: m.name,
            place_address: m.address || m.category,
            lat: m.lat,
            lng: m.lng,
            stop_type: m.category,
            emoji: m.category === 'barber' ? '💈' : (m.category === 'salon' ? '💇' : '🏪'),
            estimated_wait_minutes: 15,
            is_preferred: m.user_service_history && m.user_service_history.length > 0,
            is_network_partner: true,
            merchant_id: m.id
        }));

        // 2. FETCH MAPBOX POIs (Corridor Filling)
        const fetchCategory = async (cat: typeof STOP_CATEGORIES[0]) => {
            if (!MAPBOX_TOKEN) return [];
            const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(cat.category)}.json?proximity=${searchLng},${searchLat}&types=poi&limit=2&country=TT&access_token=${MAPBOX_TOKEN}`;
            try {
                const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
                if (!res.ok) return [];
                const json = await res.json();
                return (json.features || []).map((f: any) => ({
                    place_name: f.text || f.place_name,
                    place_address: f.place_name || cat.category,
                    lat: f.center[1],
                    lng: f.center[0],
                    stop_type: cat.stop_type,
                    emoji: cat.emoji,
                    estimated_wait_minutes: cat.wait_minutes,
                    is_preferred: false,
                    is_network_partner: false
                }));
            } catch {
                return [];
            }
        };

        const mapboxResults = await Promise.allSettled(STOP_CATEGORIES.map(fetchCategory));
        const mapboxSuggestions = mapboxResults
            .flatMap((r) => (r.status === "fulfilled" ? r.value : []));

        // 3. MERGE & PRIORITIZE (Network First, then History, then Mapbox)
        const allSuggestions = [
            ...networkSuggestions.filter(s => s.is_preferred),
            ...networkSuggestions.filter(s => !s.is_preferred),
            ...mapboxSuggestions
        ];

        // Filter duplicates and limit
        const seen = new Set();
        const suggestions = allSuggestions.filter(s => {
            const key = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).slice(0, 6);

        return new Response(
            JSON.stringify({ success: true, data: { suggestions } }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error: any) {
        console.error("suggest_stops error:", error);
        await captureException(error, { function: "suggest_stops" });
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error: " + error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
