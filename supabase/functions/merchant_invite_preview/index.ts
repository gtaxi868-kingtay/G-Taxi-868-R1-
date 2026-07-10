import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Public, unauthenticated preview of a commander's merchant invite — the
// merchant taps the link before they have any G-Taxi account, so this can't
// require a JWT. Returns only non-sensitive display fields (location name,
// address) gated by knowledge of the exact unguessable invite token — the
// same access model as the invite link itself. Never returns commander_id,
// other merchants' data, or anything beyond what's needed to reassure the
// merchant they're registering the right spot.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ipAttempts = new Map<string, { count: number; resetAt: number }>()

function checkIpRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = ipAttempts.get(ip)
  if (!entry || now > entry.resetAt) {
    ipAttempts.set(ip, { count: 1, resetAt: now + 60_000 })
    return true
  }
  if (entry.count >= 20) return false
  entry.count++
  return true
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders })

  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    if (!checkIpRateLimit(ip)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Too many attempts. Try again later.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { token } = await req.json()
    if (!token) {
      return new Response(
        JSON.stringify({ success: false, error: 'token required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: invite, error } = await supabaseAdmin
      .from('merchant_invites')
      .select('status, expires_at, merchant_name, kiosk_node:kiosk_node_id(location_name, pickup_address)')
      .eq('token', token)
      .maybeSingle()

    if (error || !invite) {
      return new Response(
        JSON.stringify({ success: false, error: 'This invite link is invalid.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (invite.status !== 'pending') {
      return new Response(
        JSON.stringify({ success: false, error: 'This invite has already been used.' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return new Response(
        JSON.stringify({ success: false, error: 'This invite link has expired. Ask your Commander to send a new one.' }),
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const kiosk = invite.kiosk_node as unknown as { location_name: string; pickup_address: string } | null

    return new Response(
      JSON.stringify({
        success: true,
        location_name: kiosk?.location_name || null,
        address: kiosk?.pickup_address || null,
        merchant_name_hint: invite.merchant_name || null,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('merchant_invite_preview error:', err)
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
