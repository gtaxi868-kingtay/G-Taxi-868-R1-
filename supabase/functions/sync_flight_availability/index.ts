import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ROUTES = [
  { origin: 'POS', dest: 'TAB', originName: 'Piarco', destName: 'Tobago' },
  { origin: 'POS', dest: 'BGI', originName: 'Piarco', destName: 'Barbados' },
  { origin: 'POS', dest: 'GND', originName: 'Piarco', destName: 'Grenada' },
  { origin: 'POS', dest: 'ANU', originName: 'Piarco', destName: 'Antigua' },
  { origin: 'POS', dest: 'SKB', originName: 'Piarco', destName: 'St Kitts' },
  { origin: 'POS', dest: 'SLU', originName: 'Piarco', destName: 'St Lucia' },
  { origin: 'POS', dest: 'SXM', originName: 'Piarco', destName: 'St Maarten' },
  { origin: 'POS', dest: 'HAV', originName: 'Piarco', destName: 'Havana' },
]

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const AMADEUS_API_KEY = Deno.env.get('AMADEUS_API_KEY')
  const AMADEUS_API_SECRET = Deno.env.get('AMADEUS_API_SECRET')

  if (!AMADEUS_API_KEY || !AMADEUS_API_SECRET) {
    return new Response(JSON.stringify({
      success: false,
      status: 'api_not_configured',
      error: 'Amadeus API credentials not configured. Set AMADEUS_API_KEY and AMADEUS_API_SECRET.',
    }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  const authResp = await fetch('https://test.api.amadeus.com/v1/security/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: AMADEUS_API_KEY,
      client_secret: AMADEUS_API_SECRET,
    }),
  })

  if (!authResp.ok) {
    return new Response(JSON.stringify({
      success: false, error: 'Amadeus auth failed',
      status: authResp.status,
    }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { access_token } = await authResp.json()

  const next14Days: string[] = []
  const today = new Date()
  for (let i = 1; i <= 14; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    next14Days.push(d.toISOString().split('T')[0])
  }

  const results: any[] = []

  for (const route of ROUTES) {
    for (const date of next14Days) {
      await new Promise(r => setTimeout(r, 80))

      try {
        const url = new URL('https://test.api.amadeus.com/v2/shopping/flight-offers')
        url.searchParams.set('originLocationCode', route.origin)
        url.searchParams.set('destinationLocationCode', route.dest)
        url.searchParams.set('departureDate', date)
        url.searchParams.set('adults', '1')
        url.searchParams.set('currencyCode', 'TTD')
        url.searchParams.set('max', '3')

        const resp = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${access_token}` },
        })

        if (!resp.ok) {
          results.push({
            route: `${route.origin}→${route.dest}`, date,
            error: `HTTP ${resp.status}`,
          })
          continue
        }

        const body = await resp.json()
        const offers = body.data ?? []

        const flightData = offers.map((offer: any) => ({
          flight_number: offer.itineraries?.[0]?.segments?.[0]?.carrierCode
            + offer.itineraries?.[0]?.segments?.[0]?.number,
          departure: offer.itineraries?.[0]?.segments?.[0]?.departure?.at,
          arrival: offer.itineraries?.[0]?.segments?.[0]?.arrival?.at,
          available_seats: offer.numberOfBookableSeats ?? 0,
          fare_cents: Math.round(parseFloat(offer.price?.total ?? '0') * 100),
          currency: offer.price?.currency ?? 'TTD',
        }))

        await fetch(
          `${supabaseUrl}/rest/v1/flight_cache`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${serviceKey}`,
              'Prefer': 'resolution=merge-duplicates',
            },
            body: JSON.stringify({
              origin: route.origin,
              destination: route.dest,
              departure_date: date,
              raw_response: flightData,
              synced_at: new Date().toISOString(),
              source: 'amadeus',
              available_seats: Math.max(...flightData.map((f: any) => f.available_seats), 0),
              lowest_fare_cents: Math.min(...flightData.map((f: any) => f.fare_cents), 0),
            }),
          }
        )

        results.push({
          route: `${route.origin}→${route.dest}`, date,
          offers: flightData.length,
        })
      } catch (err: any) {
        results.push({
          route: `${route.origin}→${route.dest}`, date,
          error: err.message,
        })
      }
    }
  }

  return new Response(JSON.stringify({
    success: true,
    routes_scanned: ROUTES.length,
    dates_scanned: next14Days.length,
    results,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
