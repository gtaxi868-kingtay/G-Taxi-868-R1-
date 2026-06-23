import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { aiFetch, secureFetch } from "../_shared/networkUtility.ts";

const MAPBOX_TOKEN = Deno.env.get("MAPBOX_ACCESS_TOKEN") ?? "";
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";

const TT_BBOX = "bbox=-61.9311,10.0280,-60.5423,10.8421";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    await checkRateLimit(supabaseAdmin, user.id, "parse_natural_language");

    const { query, current_lat, current_lng } = await req.json();
    if (!query || typeof query !== "string") {
      return new Response(
        JSON.stringify({ error: "query required", stops: [] }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let stops: Array<{ type: "pickup" | "stop" | "dropoff"; search_term: string }> = [];
    let service_type = "ride";
    let nluSucceeded = false;

    if (GROQ_API_KEY) {
      const systemPrompt = `You are a routing parser for G-TAXI in Trinidad and Tobago.
Parse ride requests into an ordered list of stops.

Trinidad place name dictionary:
- "Grande" → "Sangre Grande"
- "POS" → "Port of Spain"
- "The Base" / "S4" → "T&T Defence Force Base, Chaguaramas"
- "Savannah" → "Queen's Park Savannah, Port of Spain"
- "UWI" / "St. Augustine" → "UWI St. Augustine Campus"
- "Piarco" → "Piarco International Airport"
- "Crown Point" → "Crown Point Airport, Tobago"
- "Arima" → "Arima, Trinidad"
- "San Fernando" / "Sando" → "San Fernando, Trinidad"
- "Chaguanas" → "Chaguanas, Trinidad"
- "Maracas" → "Maracas Beach, Trinidad"
- "Toco" → "Toco, Trinidad"
- "Manzanilla" → "Manzanilla Beach, Trinidad"
- "Mayaro" → "Mayaro, Trinidad"
- "Cumuto" → "Cumuto, Trinidad"

Rules:
1. "pick me up at X" / "pickup" → type "pickup", search_term: "Current Location"
2. "stop by X" / "stop at X" → type "stop", search_term: X
3. "drop me off at X" / "drop me at X" / "take me to X" → type "dropoff", search_term: X
4. "then" / "after that" separates sequential stops
5. "home" → keep as "home"
6. "work" → keep as "work"

Output ONLY valid JSON. No markdown. No explanation.
Schema: { "stops": [{ "type": "pickup|stop|dropoff", "search_term": "cleaned location name" }], "service_type": "ride" }`;

      const groqBody = {
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Query: "${query}"\nCurrent location: [${current_lat}, ${current_lng}]` }
        ],
        temperature: 0.1,
        max_tokens: 256,
        response_format: { type: "json_object" }
      };

      try {
        const groqRes = await aiFetch(
          "https://api.groq.com/openai/v1/chat/completions",
          { method: "POST", headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(groqBody) }
        );

        if (groqRes.ok) {
          const groqData = await groqRes.json();
          const text = groqData?.choices?.[0]?.message?.content;
          if (text) {
            const parsed = JSON.parse(text);
            if (parsed.stops && Array.isArray(parsed.stops)) {
              stops = parsed.stops;
              service_type = parsed.service_type || "ride";
              nluSucceeded = true;
            }
          }
        }
      } catch (_err) {
        // Groq failed — fall through to raw geocoding
      }
    }

    if (!nluSucceeded) {
      stops = [{ type: "pickup", search_term: "Current Location" }];
      stops.push({ type: "dropoff", search_term: query });
    }

    const geocodedStops = await Promise.all(
      stops.map(async (stop) => {
        if (stop.type === "pickup") {
          return { type: stop.type, address: "Current Location", lat: current_lat, lng: current_lng };
        }

        try {
          const geoRes = await secureFetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(stop.search_term)}.json?` +
            `access_token=${MAPBOX_TOKEN}&proximity=${current_lng},${current_lat}&${TT_BBOX}&limit=1`
          );
          const geoData = await geoRes.json();
          if (geoData.features?.[0]?.geometry?.coordinates) {
            const [lng, lat] = geoData.features[0].geometry.coordinates;
            if (lat && lng) {
              return {
                type: stop.type,
                address: geoData.features[0].place_name,
                lat: Number(Number(lat).toFixed(6)),
                lng: Number(Number(lng).toFixed(6)),
              };
            }
          }
        } catch (_err) {
          // Geocode failed for this stop
        }

        const t = stop.search_term.toLowerCase();
        if (t === "home" || t === "work") {
          return { type: stop.type, address: stop.search_term, lat: current_lat + 0.008, lng: current_lng + 0.008 };
        }
        return { type: stop.type, address: stop.search_term, lat: 0, lng: 0 };
      })
    );

    let total_distance_meters = 0;
    let total_duration_seconds = 0;

    const validStops = geocodedStops.filter(s => s.lat !== 0 && s.lng !== 0);
    if (validStops.length >= 2 && MAPBOX_TOKEN) {
      const coords = validStops.map(s => `${s.lng},${s.lat}`).join(";");
      try {
        const dirRes = await secureFetch(
          `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?` +
          `access_token=${MAPBOX_TOKEN}&geometries=geojson&overview=simplified&steps=false`
        );
        const dirData = await dirRes.json();
        if (dirData.routes?.[0]) {
          total_distance_meters = Math.round(dirData.routes[0].distance);
          total_duration_seconds = Math.round(dirData.routes[0].duration);
        }
      } catch (_err) {
        const d = geocodedStops.reduce((acc, s, i, arr) => {
          if (i === 0) return acc;
          const prev = arr[i - 1];
          const R = 6371000;
          const dLat = (s.lat - prev.lat) * Math.PI / 180;
          const dLng = (s.lng - prev.lng) * Math.PI / 180;
          const a = Math.sin(dLat / 2) ** 2 + Math.cos(prev.lat * Math.PI / 180) * Math.cos(s.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          return acc + R * c;
        }, 0);
        total_distance_meters = Math.round(d * 1.3);
        total_duration_seconds = Math.round((d * 1.3) / 8.33);
      }
    }

    const { data: pricingRows } = await supabaseAdmin
      .from("pricing_config")
      .select("key, value_cents")
      .catch(() => ({ data: null }));
    const pcfg: Record<string, number> = {};
    if (pricingRows) for (const r of pricingRows) pcfg[r.key] = r.value_cents;
    const BASE = pcfg["BASE_FARE_CENTS"] ?? 1600;
    const PER_KM = pcfg["PER_KM_CENTS"] ?? 175;
    const PER_MIN = pcfg["PER_MIN_CENTS"] ?? 95;
    const MIN_FARE = pcfg["MIN_FARE_CENTS"] ?? 2200;

    const STOP_FEE_CENTS = validStops.length > 2 ? (validStops.length - 2) * 500 : 0;
    const fareCents = BASE + Math.round(total_distance_meters / 1000) * PER_KM + Math.round(total_duration_seconds / 60) * PER_MIN + STOP_FEE_CENTS;
    const finalFare = Math.max(fareCents, MIN_FARE);

    const allPois: Array<{ name: string; address: string; lat: number; lng: number; category: string }> = [];
    if (MAPBOX_TOKEN && nluSucceeded) {
      for (const stop of geocodedStops) {
        if (stop.lat === 0 || stop.lng === 0) continue;
        if (stop.type === "pickup") continue;
        const categories = ["restaurant", "cafe", "supermarket", "gas_station", "atm", "pharmacy"];
        for (const category of categories) {
          try {
            const poiRes = await secureFetch(
              `https://api.mapbox.com/geocoding/v5/mapbox.places/${category}.json?` +
              `proximity=${stop.lng},${stop.lat}&types=poi&limit=2&access_token=${MAPBOX_TOKEN}`
            );
            const poiData = await poiRes.json();
            if (poiData.features) {
              for (const f of poiData.features) {
                const [lng, lat] = f.geometry.coordinates;
                if (!allPois.some(p => Math.abs(p.lat - lat) < 0.001 && Math.abs(p.lng - lng) < 0.001)) {
                  allPois.push({
                    name: f.text,
                    address: f.place_name,
                    lat: Number(Number(lat).toFixed(6)),
                    lng: Number(Number(lng).toFixed(6)),
                    category,
                  });
                }
              }
            }
          } catch (_err) {
            // POI search failed for this category
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        stops: geocodedStops,
        suggested_pois: allPois,
        service_type,
        total_distance_meters,
        total_duration_seconds,
        estimated_fare_cents: finalFare,
        validation_required: !nluSucceeded,
        raw_query: query,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    if (error instanceof Response) return error;
    return new Response(
      JSON.stringify({ error: error.message ?? "Internal error", stops: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
