import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function requireAuth(req: Request) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
        throw new Response(JSON.stringify({ error: "Missing authorization header" }), {
            status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }
    const supabaseClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!
    );
    const { data: { user }, error } = await supabaseClient.auth.getUser(
        authHeader.replace("Bearer ", "")
    );
    if (error || !user) {
        throw new Response(JSON.stringify({ error: "Invalid or expired token" }), {
            status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }
    return user;
}

async function sendPushNotification(pushToken: string, _title: string, _body: string, _data: Record<string, string>): Promise<void> {
    try {
        const serviceAccountB64 = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
        if (!serviceAccountB64 || !pushToken) return;
        const sa = JSON.parse(atob(serviceAccountB64));
        const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
        const now = Math.floor(Date.now() / 1000);
        const payload = btoa(JSON.stringify({
            iss: sa.client_email,
            scope: "https://www.googleapis.com/auth/firebase.messaging",
            aud: "https://oauth2.googleapis.com/token",
            iat: now, exp: now + 3600,
        })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
        const pem = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s+/g, "");
        const pemBinary = atob(pem.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(pem.length / 4) * 4, "="));
        const binaryDer = Uint8Array.from(pemBinary, (c) => c.charCodeAt(0));
        const key = await crypto.subtle.importKey("pkcs8", binaryDer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
        const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${payload}`));
        const jwt = `${header}.${payload}.${btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")}`;
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
        });
        if (!tokenRes.ok) return;
        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;
        if (pushToken.startsWith("ExponentPushToken")) {
            await fetch("https://exp.host/--/api/v2/push/send", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ to: pushToken, title: _title, body: _body, data: _data, priority: "high", sound: "default" }),
            });
        } else {
            await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({ message: { token: pushToken, notification: { title: _title, body: _body }, data: _data, android: { priority: "high" } } }),
            });
        }
    } catch { /* non-fatal */ }
}

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const user = await requireAuth(req);

        const supabaseAdmin = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        const { ride_id, merchant_id } = await req.json();

        if (!ride_id || !merchant_id) {
            return new Response(
                JSON.stringify({ success: false, error: "ride_id and merchant_id required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const { data: ride, error: rideErr } = await supabaseAdmin
            .from("rides")
            .select("*")
            .eq("id", ride_id)
            .single();

        if (rideErr || !ride) {
            return new Response(
                JSON.stringify({ success: false, error: "Ride not found" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        if (ride.rider_id !== user.id) {
            return new Response(
                JSON.stringify({ success: false, error: "Forbidden" }),
                { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        if (!["assigned", "arrived", "in_progress"].includes(ride.status)) {
            return new Response(
                JSON.stringify({ success: false, error: `Cannot add stops from status '${ride.status}'` }),
                { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const { data: merchant, error: merchErr } = await supabaseAdmin
            .from("merchants")
            .select("id, name, category, lat, lng, address")
            .eq("id", merchant_id)
            .eq("is_active", true)
            .eq("activation_status", "active")
            .eq("is_open", true)
            .single();

        if (merchErr || !merchant || !merchant.lat || !merchant.lng) {
            return new Response(
                JSON.stringify({ success: false, error: "Merchant not available" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const { data: existingStops } = await supabaseAdmin
            .from("ride_stops")
            .select("stop_order")
            .eq("ride_id", ride_id)
            .eq("status", "pending")
            .order("stop_order", { ascending: false })
            .limit(1);

        const nextOrder = existingStops && existingStops.length > 0 ? existingStops[0].stop_order + 1 : 1;

        if (nextOrder > 3) {
            return new Response(
                JSON.stringify({ success: false, error: "Maximum 3 stops per ride" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const mapboxToken = Deno.env.get("MAPBOX_PUBLIC_TOKEN") || Deno.env.get("MAPBOX_ACCESS_TOKEN");
        let newDistance = ride.distance_meters || 0;
        let newDuration = ride.duration_seconds || 0;
        let newPolyline = ride.route_geometry || "";

        async function getConfigValue(key: string, fallback: number): Promise<number> {
            const { data } = await supabaseAdmin
                .from("pricing_config")
                .select("value_cents")
                .eq("key", key)
                .maybeSingle();
            return data?.value_cents ?? fallback;
        }

        const perKmCents = await getConfigValue("PER_KM_CENTS", 175);
        const stopFee = 500;

        if (mapboxToken && ride.pickup_lat && ride.pickup_lng && ride.dropoff_lat && ride.dropoff_lng) {
            try {
                const waypoints = `${ride.pickup_lng},${ride.pickup_lat};${merchant.lng},${merchant.lat};${ride.dropoff_lng},${ride.dropoff_lat}`;
                const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${encodeURIComponent(waypoints)}?geometries=polyline&access_token=${mapboxToken}`;
                const resp = await fetch(url);
                const json = await resp.json();

                if (json.routes && json.routes[0]) {
                    newDistance = Math.round(json.routes[0].distance);
                    newDuration = Math.round(json.routes[0].duration);
                    newPolyline = json.routes[0].geometry;
                }
            } catch (err) {
                console.error("Mapbox reroute failed (non-fatal):", err);
            }
        }

        const originalFare = ride.total_fare_cents || 0;
        const originalDistance = ride.distance_meters || 1;
        const detourKm = Math.max(0, (newDistance - originalDistance) / 1000);
        const distanceCharge = Math.round(detourKm * perKmCents);
        const fareDelta = distanceCharge + stopFee;
        const newFare = originalFare + fareDelta;

        if (newFare > originalFare * 2) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "Stop would double fare. Please choose a closer merchant.",
                    data: { fare_delta_cents: fareDelta, new_fare_cents: newFare },
                }),
                { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const { error: stopErr } = await supabaseAdmin
            .from("ride_stops")
            .insert({
                ride_id,
                stop_order: nextOrder,
                place_name: merchant.name,
                place_address: merchant.address,
                lat: merchant.lat,
                lng: merchant.lng,
                stop_type: "merchant",
                estimated_wait_minutes: 10,
                stop_convenience_fee_cents: stopFee,
                status: "pending",
            });

        if (stopErr) {
            console.error("Failed to insert stop:", stopErr);
            return new Response(
                JSON.stringify({ success: false, error: "Failed to add stop" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        await supabaseAdmin
            .from("rides")
            .update({
                total_fare_cents: newFare,
                route_geometry: newPolyline,
                distance_meters: newDistance,
                duration_seconds: newDuration,
                has_stops: true,
            })
            .eq("id", ride_id);

        const { error: logErr } = await supabaseAdmin
            .from("ride_events")
            .insert({
                event_type: "stop_added",
                ride_id,
                metadata: {
                    place_name: merchant.name,
                    place_lat: merchant.lat,
                    place_lng: merchant.lng,
                    stop_order: nextOrder,
                    fare_delta_cents: fareDelta,
                },
            });
        if (logErr) console.error("Failed to log ride_event:", logErr);

        if (ride.driver_id) {
            const { data: driver } = await supabaseAdmin
                .from("drivers")
                .select("push_token")
                .eq("id", ride.driver_id)
                .single();

            if (driver?.push_token) {
                sendPushNotification(
                    driver.push_token,
                    "New Stop Added",
                    `Rider added ${merchant.name} as a stop. Route updated.`,
                    {
                        type: "STOP_ADDED",
                        ride_id,
                        merchant_name: merchant.name,
                        stop_order: nextOrder.toString(),
                        eta_minutes: Math.round(newDuration / 60).toString(),
                    }
                ).catch((err) => console.error("Push to driver failed (non-fatal):", err));
            }
        }

        return new Response(
            JSON.stringify({
                success: true,
                data: {
                    stop_order: nextOrder,
                    merchant_name: merchant.name,
                    fare_delta_cents: fareDelta,
                    new_fare_cents: newFare,
                    new_eta_seconds: newDuration,
                    new_distance_meters: newDistance,
                },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error("add_merchant_stop error:", error);
        return new Response(
            JSON.stringify({ success: false, error: "Internal server error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
