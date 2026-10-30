import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { redisCommand } from "../_shared/redis.ts"
import { requireAuth } from "../_shared/auth.ts"
import { enforceRateLimit } from "../_shared/rateLimit.ts"


import { getCorsHeaders } from "../_shared/cors.ts";

// Hard server-side ceiling on the search radius (register #11). The radius
// was caller-supplied and unclamped: any registered account could pass a
// huge radius and dump every online driver's live coordinates. 25 km covers
// any legitimate pickup-area view in T&T; larger requests are clamped, not
// honoured.
const MAX_RADIUS_KM = 25;
const DEFAULT_RADIUS_KM = 5;

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Auth check: only registered users can see driver locations
    const user = await requireAuth(req)

    // 1b. Rate limit per user (config in _shared/rateLimit.ts). Throws a
    // 429 Response when exceeded; handled in the catch below.
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    await enforceRateLimit(supabaseAdmin, user.id, "get_nearby_drivers", corsHeaders)

    const { lat, lng, radius = DEFAULT_RADIUS_KM } = await req.json()

    // Coordinates must be real, finite numbers in valid ranges. (The old
    // `!lat || !lng` check also rejected the legitimate value 0.)
    const latNum = typeof lat === 'number' ? lat : Number(lat)
    const lngNum = typeof lng === 'number' ? lng : Number(lng)
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum) ||
        latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid coordinates" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const radiusNum = Number(radius)
    const radiusKm = !Number.isFinite(radiusNum) || radiusNum <= 0
      ? DEFAULT_RADIUS_KM
      : Math.min(radiusNum, MAX_RADIUS_KM)

    // 2. Query Redis for nearby drivers
    // GEORADIUS key longitude latitude radius unit [WITHCOORD] [WITHDIST]
    // Response carries only id + coordinates — exactly what the rider
    // pickup flow consumes (useNearbyDrivers maps { id, lat, lng }).
    const results = await redisCommand([
      "GEORADIUS",
      "active_drivers",
      lngNum.toString(),
      latNum.toString(),
      radiusKm.toString(),
      "km",
      "WITHCOORD"
    ])

    // results format: [ ["driver_id", ["lng", "lat"]], ... ]
    const drivers = (results || []).map((res: any) => {
        const [id, [lngStr, latStr]] = res;
        return {
            id,
            lat: parseFloat(latStr),
            lng: parseFloat(lngStr)
        }
    })

    return new Response(
      JSON.stringify({ drivers }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    // requireAuth / enforceRateLimit signal denial by throwing a Response.
    if (error instanceof Response) return error
    console.error("get_nearby_drivers error:", error)
    return new Response(
      JSON.stringify({ error: error.message || "Internal Server Error" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
