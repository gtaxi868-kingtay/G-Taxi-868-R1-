import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MAPBOX_TOKEN = Deno.env.get("MAPBOX_PUBLIC_TOKEN") ?? "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STOP_CATEGORIES = [
    { category: "pharmacy",   emoji: "\u{1F48A}", stop_type: "pharmacy",  wait_minutes: 10 },
    { category: "grocery",    emoji: "\u{1F6D2}", stop_type: "grocery",   wait_minutes: 15 },
    { category: "bank",       emoji: "\u{1F3E6}", stop_type: "errand",    wait_minutes: 10 },
    { category: "atm",        emoji: "\u{1F4B5}", stop_type: "errand",    wait_minutes: 5  },
    { category: "bakery",     emoji: "\u{1F950}", stop_type: "food",      wait_minutes: 8  },
];

function midpoint(lat1: number, lng1: number, lat2: number, lng2: number) {
    return { lat: (lat1 + lat2) / 2, lng: (lng1 + lng2) / 2 };
}

function coordsToZone(lat: number, lng: number): string {
    return `${Math.round(lat * 1000) / 1000},${Math.round(lng * 1000) / 1000}`;
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
        const { pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, ride_id } = body;

        if (!pickup_lat || !pickup_lng) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing coordinates" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const { lat: searchLat, lng: searchLng } = dropoff_lat
            ? midpoint(pickup_lat, pickup_lng, dropoff_lat, dropoff_lng)
            : { lat: pickup_lat, lng: pickup_lng };

        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        const currentHour = new Date().getHours();
        const currentDay = new Date().getDay();
        const isWeekend = currentDay === 0 || currentDay === 6;

        const { data: patternMerchants } = await supabaseAdmin
            .from("rider_route_patterns")
            .select(`
                typical_merchant_id,
                probability,
                sample_size,
                time_window,
                last_observed_at
            `)
            .eq("rider_id", user.id)
            .eq("origin_zone", coordsToZone(pickup_lat, pickup_lng))
            .eq("destination_zone", dropoff_lat && dropoff_lng ? coordsToZone(dropoff_lat, dropoff_lng) : coordsToZone(pickup_lat, pickup_lng))
            .gte("probability", 0.3)
            .order("probability", { ascending: false });

        let predictions: any[] = [];
        if (patternMerchants && patternMerchants.length > 0) {
            const merchantIds = patternMerchants
                .filter((p: any) => p.typical_merchant_id)
                .map((p: any) => p.typical_merchant_id);

            if (merchantIds.length > 0) {
                const { data: merchants } = await supabaseAdmin
                    .from("merchants")
                    .select("id, name, address, lat, lng, category, is_open")
                    .in("id", merchantIds)
                    .eq("is_active", true);

                predictions = (merchants || []).map((m: any) => {
                    const pattern = patternMerchants.find((p: any) => p.typical_merchant_id === m.id);
                    return {
                        place_name: m.name,
                        place_address: m.address || m.category,
                        lat: m.lat,
                        lng: m.lng,
                        stop_type: m.category,
                        emoji: m.category === 'restaurant' ? '\u{1F37D}' : m.category === 'pharmacy' ? '\u{1F48A}' : '\u{1F3EA}',
                        estimated_wait_minutes: 10,
                        is_preferred: true,
                        is_network_partner: true,
                        merchant_id: m.id,
                        is_prediction: true,
                        prediction_probability: pattern?.probability || 0,
                    };
                });
            }
        }

        const { data: networkMerchants } = await supabaseAdmin
            .from("merchants")
            .select("id, name, address, lat, lng, category, is_open")
            .neq("category", "grocery")
            .neq("category", "laundry")
            .eq("is_active", true)
            .eq("is_open", true);

        const networkSuggestions = (networkMerchants || [])
            .filter((m: any) => {
                if (!m.lat || !m.lng) return false;
                const dist = Math.sqrt(
                    Math.pow(m.lat - searchLat, 2) +
                    Math.pow(m.lng - searchLng, 2)
                );
                return dist < 0.045;
            })
            .map((m: any) => {
                let timeBoost = 1;
                if (currentHour >= 11 && currentHour <= 14 && ['restaurant', 'local', 'indian', 'chinese', 'pizza', 'seafood', 'bakery', 'creole'].includes(m.category)) {
                    timeBoost = 2;
                } else if (currentHour >= 17 && currentHour <= 21 && ['restaurant', 'pizza', 'seafood', 'creole'].includes(m.category)) {
                    timeBoost = 2;
                }
                if (isWeekend) timeBoost = Math.max(timeBoost, 1.5);

                return {
                    place_name: m.name,
                    place_address: m.address || m.category,
                    lat: m.lat,
                    lng: m.lng,
                    stop_type: m.category,
                    emoji: m.category === 'restaurant' ? '\u{1F37D}' : m.category === 'pharmacy' ? '\u{1F48A}' : m.category === 'barber' ? '\u{1F488}' : m.category === 'salon' ? '\u{1F487}' : '\u{1F3EA}',
                    estimated_wait_minutes: 10,
                    is_preferred: false,
                    is_network_partner: true,
                    merchant_id: m.id,
                    _time_boost: timeBoost,
                };
            });

        const fetchCategory = async (cat: typeof STOP_CATEGORIES[0]) => {
            if (!MAPBOX_TOKEN) return [];
            const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(cat.category)}.json?proximity=${searchLng},${searchLat}&types=poi&limit=2&country=TT&access_token=${MAPBOX_TOKEN}`;
            try {
                const res = await fetch(url);
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
                    is_network_partner: false,
                }));
            } catch {
                return [];
            }
        };

        const mapboxResults = await Promise.allSettled(STOP_CATEGORIES.map(fetchCategory));
        const mapboxSuggestions = mapboxResults
            .flatMap((r) => (r.status === "fulfilled" ? r.value : []));

        const allSuggestions = [
            ...predictions,
            ...networkSuggestions,
            ...mapboxSuggestions,
        ];

        const seen = new Set();
        const suggestions = allSuggestions
            .filter(s => {
                const key = `${s.lat?.toFixed(4)},${s.lng?.toFixed(4)}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .sort((a: any, b: any) => {
                if (a.is_prediction && !b.is_prediction) return -1;
                if (!a.is_prediction && b.is_prediction) return 1;
                return (b._time_boost || 1) - (a._time_boost || 1);
            })
            .slice(0, 6);

        const grouped: any = {};
        if (predictions.length > 0) {
            grouped.predictions = suggestions.filter((s: any) => s.is_prediction);
        }
        grouped.favorites = suggestions.filter((s: any) => s.is_preferred && !s.is_prediction);
        grouped.nearby = suggestions.filter((s: any) => !s.is_preferred && !s.is_prediction);

        return new Response(
            JSON.stringify({ success: true, data: { suggestions, grouped } }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error: any) {
        console.error("suggest_stops error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error: " + error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
