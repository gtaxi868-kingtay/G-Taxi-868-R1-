import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { bookingConfigured, fetchBookingNightlyRate } from '../_shared/bookingCom.ts'

// Booking.com -> hotel rate SUGGESTIONS (founder, 2026-10-26: rates from
// Booking.com "built but inactive"). For every claimed hotel with a
// booking_hotel_id, asks Booking.com for tonight-plus-stay pricing and files
// a lodging_rate_suggestions row the hotel accepts or dismisses in its app.
// Nothing here ever changes a live rate.
//
// The previous version of this function queried a retired endpoint with
// country codes as hotel ids and wrote columns lodging_cache does not have,
// so it could never have worked; it is replaced, not patched.
//
// INACTIVE: returns not_configured until BOOKING_API_KEY and
// BOOKING_AFFILIATE_ID are set, and has no cron job yet. To switch on after
// Booking.com approval: set both secrets, then schedule this daily with the
// cron secret (see .scratch/business-console/tasks.md).

const CRON_SECRET = Deno.env.get('PLATFORM_CRON_SECRET') ?? ''

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return json({ error: 'Unauthorized' }, 401)
  }
  if (!bookingConfigured()) {
    return json({ success: false, status: 'api_not_configured', error: 'Booking.com is not switched on: needs partner approval, then BOOKING_API_KEY and BOOKING_AFFILIATE_ID.' }, 503)
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const { data: hotels, error } = await supabase
    .from('lodging_nodes')
    .select('id, name, merchant_id, booking_hotel_id, nights, max_guests')
    .not('booking_hotel_id', 'is', null)
    .not('merchant_id', 'is', null)
  if (error) return json({ success: false, error: error.message }, 500)

  // Price a stay starting two weeks out: close enough to be real, far enough
  // that it is not a last-minute rate.
  const start = new Date(Date.now() - 4 * 3_600_000 + 14 * 86_400_000).toISOString().slice(0, 10)
  const results: Record<string, unknown>[] = []
  for (const h of hotels || []) {
    const nights = Math.max(1, h.nights || 1)
    const checkout = new Date(Date.parse(`${start}T12:00:00Z`) + nights * 86_400_000).toISOString().slice(0, 10)
    const res = await fetchBookingNightlyRate(String(h.booking_hotel_id), start, checkout, Math.min(2, h.max_guests || 2))
    if (!res.ok) { results.push({ hotel: h.name, error: res.error }); continue }
    if (!res.rate) { results.push({ hotel: h.name, found: false }); continue }

    await supabase.from('lodging_rate_suggestions').update({ status: 'superseded' })
      .eq('lodging_id', h.id).eq('source', 'booking_com').eq('status', 'pending')
    const { error: insErr } = await supabase.from('lodging_rate_suggestions').insert({
      lodging_id: h.id, source: 'booking_com',
      rate_cents: res.rate.rate_cents, currency: res.rate.currency, amount_text: res.rate.amount_text,
      excerpt: `Booking.com price for ${nights} night(s) from ${start}`,
    })
    await supabase.from('business_audit_log').insert({
      merchant_id: h.merchant_id, lodging_id: h.id, action: 'booking_com_read',
      detail: { found: res.rate.amount_text, insert_error: insErr?.message ?? null },
    })
    results.push({ hotel: h.name, suggested: res.rate.amount_text })
  }
  return json({ success: true, hotels: (hotels || []).length, results })
})
