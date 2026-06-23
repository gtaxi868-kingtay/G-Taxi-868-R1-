import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAPBOX_TOKEN = Deno.env.get("EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN");

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get("Authorization");
        const supabaseClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!);
        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        const { data: { user }, error: authErr } = await supabaseClient.auth.getUser(
            authHeader?.replace("Bearer ", "") ?? ""
        );
        if (authErr || !user) {
            return new Response(
                JSON.stringify({ success: false, error: "Unauthorized" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const body = await req.json();
        const { pickup_lat, pickup_lng, dropoff_lat, dropoff_lng } = body;

        if (!pickup_lat || !pickup_lng || !dropoff_lat || !dropoff_lng) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing coordinates", data: null }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        let distanceMeters = 0;
        let durationSeconds = 0;
        let mapboxSuccess = false;

        if (MAPBOX_TOKEN) {
            try {
                const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${pickup_lng},${pickup_lat};${dropoff_lng},${dropoff_lat}?access_token=${MAPBOX_TOKEN}`;
                const ac = new AbortController();
                const timeout = setTimeout(() => ac.abort(), 10000);
                const response = await fetch(url, { signal: ac.signal });
                clearTimeout(timeout);
                const data = await response.json();

                if (data.routes && data.routes.length > 0) {
                    distanceMeters = Math.round(data.routes[0].distance);
                    durationSeconds = Math.round(data.routes[0].duration);
                    mapboxSuccess = true;
                }
            } catch (err) {
                console.error("Mapbox routing failed:", err);
            }
        }

        if (!mapboxSuccess) {
            const R = 6371000;
            const dLat1 = (dropoff_lat - pickup_lat) * Math.PI / 180;
            const dLng1 = (dropoff_lng - pickup_lng) * Math.PI / 180;
            const a = Math.sin(dLat1 / 2) ** 2 + Math.cos(pickup_lat * Math.PI / 180) * Math.cos(dropoff_lat * Math.PI / 180) * Math.sin(dLng1 / 2) ** 2;
            distanceMeters = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
            durationSeconds = Math.round(distanceMeters / 8.33);
        }

        if (distanceMeters < 100) {
            return new Response(
                JSON.stringify({ success: false, error: "Pickup and dropoff are too close." }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const { data: zones } = await adminClient
            .from("zone_pricing")
            .select("*");

        let baseFare = 1600;
        let perKm = 175;
        let perMin = 95;

        if (zones && zones.length > 0) {
            for (const zone of zones) {
                try {
                    const zoneCoords = zone.boundaries?.coordinates?.[0];
                    if (!zoneCoords) continue;
                    const pickupPoint = [pickup_lng, pickup_lat];
                    const inside = pointInPolygon(pickupPoint, zoneCoords);
                    if (inside) {
                        baseFare = zone.base_fare_cents ?? baseFare;
                        perKm = zone.per_km_cents ?? perKm;
                        perMin = zone.per_min_cents ?? perMin;
                        break;
                    }
                } catch {}
            }
        }

        const distanceKm = distanceMeters / 1000;
        const durationMin = durationSeconds / 60;
        const distanceCost = Math.round(distanceKm * perKm);
        const timeCost = Math.round(durationMin * perMin);
        const subtotalCents = baseFare + distanceCost + timeCost;
        const minFare = 2200;
        const estimatedFareCents = Math.max(subtotalCents, minFare);

        return new Response(
            JSON.stringify({
                success: true,
                error: null,
                data: {
                    estimated_fare_cents: estimatedFareCents,
                    base_fare_cents: baseFare,
                    distance_km: Math.round(distanceKm * 10) / 10,
                    duration_min: Math.round(durationMin),
                    distance_cost_cents: distanceCost,
                    time_cost_cents: timeCost,
                }
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (error: any) {
        console.error("estimate_fare error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});

function pointInPolygon(point: number[], polygon: number[][]): boolean {
    const [x, y] = point;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}
