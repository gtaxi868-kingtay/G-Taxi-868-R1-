import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const MAPBOX_TOKEN = Deno.env.get("MAPBOX_ACCESS_TOKEN") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Escape values interpolated into HTML body context (prevents stored XSS from
// driver-controlled fields like name / vehicle_model / plate_number).
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Escape values interpolated inside a single-quoted JS string literal.
function escapeJs(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const user = await requireAuth(req);
    const url = new URL(req.url);
    const rideId = url.searchParams.get("ride_id");

    if (!rideId) {
      return new Response(JSON.stringify({ error: "Ride ID required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    await checkRateLimit(supabaseAdmin, user.id, "mirror_ride");

    const { data: ride } = await supabaseAdmin
      .from("rides")
      .select("*, drivers!inner(id, name, vehicle_model, plate_number, lat, lng)")
      .eq("id", rideId)
      .single();

    if (!ride) {
      return new Response(JSON.stringify({ error: "Ride not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const isRider = ride.rider_id === user.id;
    const isDriver = ride.drivers?.user_id === user.id;
    const isAdmin = profile?.role === "admin";

    if (!isRider && !isDriver && !isAdmin) {
      return new Response(JSON.stringify({ error: "Not authorized to view this ride" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    const userJwt = authHeader?.replace("Bearer ", "") || "";

    // Pre-sanitize every interpolated value by context.
    const driverName = escapeHtml(ride.drivers?.name || "Driver");
    const driverInitial = escapeHtml((ride.drivers?.name || "D").charAt(0));
    const dropoffAddress = escapeHtml(ride.dropoff_address || "Destination");
    const vehicleModel = escapeHtml(ride.drivers?.vehicle_model || "Premium Vehicle");
    const plateNumber = escapeHtml(ride.drivers?.plate_number || "GT-868");
    // Numeric coords coerced to Number (NaN-safe), can never carry markup.
    const centerLng = Number(ride.drivers?.lng ?? ride.pickup_lng) || 0;
    const centerLat = Number(ride.drivers?.lat ?? ride.pickup_lat) || 0;
    // JS-string contexts.
    const jsJwt = escapeJs(userJwt);
    const jsRideId = escapeJs(rideId);
    const jsDriverId = escapeJs(ride.driver_id);
    const jsStatus = escapeJs(ride.status);

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <title>G-TAXI | Guardian Shield</title>
        <script src="https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.js"></script>
        <link href="https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.css" rel="stylesheet" />
        <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.31.0/dist/umd/supabase.js"></script>
        <style>
            body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #000; color: #fff; }
            #map { position: absolute; top: 0; bottom: 0; width: 100%; height: 65%; }
            #hud { position: absolute; bottom: 0; width: 100%; height: 35%; background: rgba(10, 10, 31, 0.95); border-top: 1px solid rgba(0, 255, 255, 0.2); padding: 20px; box-sizing: border-box; }
            .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; background: rgba(124, 58, 237, 0.2); border: 1px solid #7C3AED; color: #00FFFF; font-size: 10px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 12px; }
            h1 { font-size: 24px; margin: 0; font-weight: 800; margin-bottom: 4px; }
            p { color: rgba(255, 255, 255, 0.6); margin: 0; font-size: 14px; }
            .driver-info { margin-top: 20px; display: flex; align-items: center; gap: 15px; }
            .avatar { width: 44px; height: 44px; border-radius: 22px; background: #7C3AED; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 18px; }
            .plate { color: #00FFFF; font-weight: 800; border: 1px solid rgba(0, 255, 255, 0.3); padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-top: 5px; display: inline-block; }
        </style>
    </head>
    <body>
        <div id="map"></div>
        <div id="hud">
            <div class="badge">Guardian Shield Restricted Access</div>
            <h1>${driverName}</h1>
            <p>Heading to ${dropoffAddress}</p>

            <div class="driver-info">
                <div class="avatar">${driverInitial}</div>
                <div>
                    <p style="color: #fff; font-weight: 700;">${vehicleModel}</p>
                    <span class="plate">${plateNumber}</span>
                </div>
            </div>
            
            <p style="margin-top: 20px; font-size: 11px; opacity: 0.5;">REAL-TIME SIGNAL: <span id="status" style="color: #00FFFF;">LOCALIZING...</span></p>
        </div>

        <script>
            const supabaseClient = supabase.createClient('${SUPABASE_URL}', '${SUPABASE_ANON_KEY}', {
                global: { headers: { Authorization: 'Bearer ${jsJwt}' } }
            });
            mapboxgl.accessToken = '${MAPBOX_TOKEN}';

            const map = new mapboxgl.Map({
                container: 'map',
                style: 'mapbox://styles/mapbox/dark-v11',
                center: [${centerLng}, ${centerLat}],
                zoom: 14,
                pitch: 45
            });

            const marker = new mapboxgl.Marker({ color: '#00FFFF' })
                .setLngLat([${centerLng}, ${centerLat}])
                .addTo(map);

            const channel = supabaseClient
                .channel('ride-mirror-${jsRideId}')
                .on('postgres_changes', {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'rides',
                    filter: 'id=eq.${jsRideId}'
                }, payload => {
                    const { driver_lat, driver_lng, status } = payload.new;
                    if (driver_lat && driver_lng) {
                        marker.setLngLat([driver_lng, driver_lat]);
                        map.easeTo({ center: [driver_lng, driver_lat], duration: 1000 });
                    }
                    document.getElementById('status').innerText = 'LIVE · ' + status.toUpperCase();
                })
                .on('postgres_changes', {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'drivers',
                    filter: 'id=eq.${jsDriverId}'
                }, payload => {
                    const { lat, lng } = payload.new;
                    if (lat && lng) {
                        marker.setLngLat([lng, lat]);
                        map.easeTo({ center: [lng, lat], duration: 1000 });
                    }
                })
                .subscribe();

            document.getElementById('status').innerText = 'LIVE · ${jsStatus}'.toUpperCase();
        </script>
    </body>
    </html>
    `;

    return new Response(html, {
      headers: { "Content-Type": "text/html" },
    });

  } catch (err: any) {
    if (err instanceof Response) return err;
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
