// supabase/functions/mirror_ride/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const MAPBOX_TOKEN = Deno.env.get("MAPBOX_ACCESS_TOKEN") || "";

serve(async (req: Request) => {
  const url = new URL(req.url);
  const rideId = url.searchParams.get("ride_id");

  if (!rideId) {
    return new Response("Ride ID required", { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: ride } = await supabase
    .from("rides")
    .select("*, drivers!inner(full_name, car_model, car_plate)")
    .eq("id", rideId)
    .single();

  if (!ride) {
    return new Response("Ride not found", { status: 404 });
  }

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
            <h1>${ride.drivers?.full_name || 'Driver'}</h1>
            <p>Heading to ${ride.destination_address || 'Destination'}</p>
            
            <div class="driver-info">
                <div class="avatar">${(ride.drivers?.full_name || 'D').charAt(0)}</div>
                <div>
                    <p style="color: #fff; font-weight: 700;">${ride.drivers?.car_model || 'Premium Vehicle'}</p>
                    <span class="plate">${ride.drivers?.car_plate || 'GT-868'}</span>
                </div>
            </div>
            
            <p style="margin-top: 20px; font-size: 11px; opacity: 0.5;">REAL-TIME SIGNAL: <span id="status" style="color: #00FFFF;">LOCALIZING...</span></p>
        </div>

        <script>
            // Note: In local simulation withsupabase-js we'd need to properly feed credentials
            // For production, the URL and ANON KEY are baked into the Deno environment
            const supabaseClient = supabase.createClient('${SUPABASE_URL}', '${SUPABASE_ANON_KEY}');
            mapboxgl.accessToken = '${MAPBOX_TOKEN}';
            
            const map = new mapboxgl.Map({
                container: 'map',
                style: 'mapbox://styles/mapbox/dark-v11',
                center: [${ride.pickup_longitude}, ${ride.pickup_latitude}],
                zoom: 14,
                pitch: 45
            });

            const marker = new mapboxgl.Marker({ color: '#00FFFF' })
                .setLngLat([${ride.pickup_longitude}, ${ride.pickup_latitude}])
                .addTo(map);

            // Subscribe to real-time location updates for this ride
            const channel = supabaseClient
                .channel('ride-mirror-${rideId}')
                .on('postgres_changes', { 
                    event: 'UPDATE', 
                    schema: 'public', 
                    table: 'rides', 
                    filter: 'id=eq.${rideId}' 
                }, payload => {
                    const { last_lat, last_lng, status } = payload.new;
                    if (last_lat && last_lng) {
                        marker.setLngLat([last_lng, last_lat]);
                        map.easeTo({ center: [last_lng, last_lat], duration: 1000 });
                        document.getElementById('status').innerText = 'LIVE · ' + status.toUpperCase();
                    }
                })
                .subscribe();

            document.getElementById('status').innerText = 'LIVE · ${ride.status.toUpperCase()}';
        </script>
    </body>
    </html>
  `;

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
});
