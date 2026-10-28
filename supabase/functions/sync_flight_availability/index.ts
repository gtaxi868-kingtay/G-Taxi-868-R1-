import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

import { getCorsHeaders } from '../_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { refreshFlightPickups } from '../_shared/flightPickups.ts'
const CRON_SECRET = Deno.env.get('PLATFORM_CRON_SECRET') ?? ''


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

// Amadeus returns local datetimes like "2026-09-20T14:30:00" (no offset).
// flight_cache.departure_time/arrival_time are `time`, not `timestamptz`,
// so we only need the HH:MM:SS half.
function extractTime(iso: string | undefined): string | null {
  if (!iso) return null
  const parts = iso.split('T')
  return parts.length > 1 ? parts[1].slice(0, 8) : null
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Every 10 minutes (cron refresh-flight-pickups-10min): keep hotel-booked
  // airport pickups on the real arrival time. Separate from the Amadeus fare
  // sync below, which needs its own keys.
  const body = await req.json().catch(() => ({}))
  if (body?.mode === 'refresh_flight_pickups') {
    try {
      const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
      const result = await refreshFlightPickups(sb)
      return new Response(JSON.stringify(result), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    } catch (e) {
      console.error('refresh_flight_pickups failed:', e)
      return new Response(JSON.stringify({ success: false, error: String((e as Error)?.message || e) }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

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

  // Amadeus's self-service sandbox host. A real production key requires a
  // separate "Move to Production" step with Amadeus and a switch to
  // api.amadeus.com — not done here, flagged separately to the user.
  const AMADEUS_HOST = Deno.env.get('AMADEUS_ENV') === 'production'
    ? 'https://api.amadeus.com'
    : 'https://test.api.amadeus.com'

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  const authResp = await fetch(`${AMADEUS_HOST}/v1/security/oauth2/token`, {
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
        const url = new URL(`${AMADEUS_HOST}/v2/shopping/flight-offers`)
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

        // flight_cache stores one real row per offer (flight_number,
        // airline_code, departure_time, arrival_time, fare_cents are all
        // NOT NULL) — it is not a route/date aggregate table. The previous
        // version posted an aggregate payload whose keys didn't even match
        // the schema, so every insert failed silently (fetch response was
        // never checked).
        let insertedForRouteDate = 0
        const skipped: string[] = []

        for (const offer of offers) {
          const segment = offer.itineraries?.[0]?.segments?.[0]
          const carrierCode = segment?.carrierCode
          const number = segment?.number
          const departureTime = extractTime(segment?.departure?.at)
          const arrivalTime = extractTime(segment?.arrival?.at)
          const fareCents = Math.round(parseFloat(offer.price?.total ?? '0') * 100)

          if (!carrierCode || !number || !departureTime || !arrivalTime || !fareCents) {
            skipped.push(offer.id ?? 'unknown')
            continue
          }

          const insertResp = await fetch(`${supabaseUrl}/rest/v1/flight_cache`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${serviceKey}`,
              'apikey': serviceKey,
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({
              origin_code: route.origin,
              destination_code: route.dest,
              departure_date: date,
              flight_number: `${carrierCode}${number}`,
              airline_code: carrierCode,
              departure_time: departureTime,
              arrival_time: arrivalTime,
              available_seats: offer.numberOfBookableSeats ?? 0,
              fare_cents: fareCents,
              currency: offer.price?.currency ?? 'TTD',
              raw_json: offer,
            }),
          })

          if (!insertResp.ok) {
            const errBody = await insertResp.text()
            console.error(`flight_cache insert failed for ${route.origin}->${route.dest} ${date}:`, insertResp.status, errBody)
            skipped.push(offer.id ?? 'unknown')
            continue
          }

          insertedForRouteDate++
        }

        results.push({
          route: `${route.origin}→${route.dest}`, date,
          offers_found: offers.length,
          offers_cached: insertedForRouteDate,
          skipped: skipped.length,
        })
      } catch (err: any) {
        console.error(`sync_flight_availability error for ${route.origin}->${route.dest} ${date}:`, err.message)
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
