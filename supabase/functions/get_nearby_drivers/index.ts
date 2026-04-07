import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { redisCommand } from "../_shared/redis.ts"
import { requireAuth } from "../_shared/auth.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Auth check: only registered users can see driver locations
    await requireAuth(req)

    const { lat, lng, radius = 5 } = await req.json()

    if (!lat || !lng) {
      return new Response(
        JSON.stringify({ error: "Missing coordinates" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. Query Redis for nearby drivers
    // GEORADIUS key longitude latitude radius unit [WITHCOORD] [WITHDIST]
    const results = await redisCommand([
      "GEORADIUS", 
      "active_drivers", 
      lng.toString(), 
      lat.toString(), 
      radius.toString(), 
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
    console.error("get_nearby_drivers error:", error)
    return new Response(
      JSON.stringify({ error: error.message || "Internal Server Error" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
