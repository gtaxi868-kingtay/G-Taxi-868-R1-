import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LOCATIONS = [
  { id: 'TAB', name: 'Tobago', country: 'TT' },
  { id: 'BGI', name: 'Barbados', country: 'BB' },
  { id: 'GND', name: 'Grenada', country: 'GD' },
  { id: 'ANU', name: 'Antigua', country: 'AG' },
]

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const BOOKING_API_KEY = Deno.env.get('BOOKING_API_KEY')

  if (!BOOKING_API_KEY) {
    return new Response(JSON.stringify({
      success: false,
      status: 'api_not_configured',
      error: 'Booking.com API key not configured. Set BOOKING_API_KEY.',
    }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  const next90Days: string[] = []
  const today = new Date()
  for (let i = 0; i < 90; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    next90Days.push(d.toISOString().split('T')[0])
  }

  const results: any[] = []

  for (const loc of LOCATIONS) {
    await new Promise(r => setTimeout(r, 200))

    try {
      const url = new URL('https://distribution-xml.booking.com/2.0/json/hotelAvailability')
      url.searchParams.set('hotel_ids', loc.country)
      url.searchParams.set('checkin', next90Days[0])
      url.searchParams.set('checkout', next90Days[next90Days.length - 1])
      url.searchParams.set('currency', 'TTD')

      const resp = await fetch(url.toString(), {
        headers: {
          Authorization: `Basic ${btoa(`${BOOKING_API_KEY}:`)}`,
          'Content-Type': 'application/json',
        },
      })

      if (!resp.ok) {
        results.push({
          location: loc.name, error: `Booking.com API HTTP ${resp.status}`,
        })
        continue
      }

      const body = await resp.json()

      const lodgingData = {
        location_id: loc.id,
        location_name: loc.name,
        raw_response: body,
        synced_at: new Date().toISOString(),
        source: 'booking_com',
        available_rooms: body?.hotelAvailability?.length ?? 0,
        lowest_rate_cents: 0,
      }

      if (body?.hotelAvailability?.length) {
        const rates = body.hotelAvailability
          .flatMap((h: any) => h.roomAvailability ?? [])
          .map((r: any) => r.totalPrice?.amount ? Math.round(parseFloat(r.totalPrice.amount) * 100) : Infinity)
          .filter((c: number) => c > 0 && isFinite(c))
        if (rates.length) lodgingData.lowest_rate_cents = Math.min(...rates)
      }

      await fetch(
        `${supabaseUrl}/rest/v1/lodging_cache`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify(lodgingData),
        }
      )

      results.push({
        location: loc.name,
        hotels_found: body?.hotelAvailability?.length ?? 0,
      })
    } catch (err: any) {
      results.push({
        location: loc.name, error: err.message,
      })
    }
  }

  return new Response(JSON.stringify({
    success: true,
    locations_scanned: LOCATIONS.length,
    results,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
