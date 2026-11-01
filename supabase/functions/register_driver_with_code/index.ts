import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkRateLimit } from '../_shared/rateLimit.ts'


import { getCorsHeaders } from '../_shared/cors.ts'
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!
    )

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    )

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const rateCheck = await checkRateLimit(supabaseAdmin, user.id, 'register_driver_with_code')
    if (!rateCheck.allowed) {
      return new Response(
        JSON.stringify({ success: false, error: rateCheck.error }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: blockCheck } = await supabaseAdmin
      .from('profiles')
      .select('platform_blocked, platform_blocked_reason')
      .eq('id', user.id)
      .maybeSingle()
    if (blockCheck?.platform_blocked) {
      return new Response(
        JSON.stringify({ success: false, error: blockCheck.platform_blocked_reason || 'Account blocked. Contact support.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { commander_code, name, phone_number, vehicle_model, plate_number, vehicle_type, driver_referral_code } = await req.json()

    if (!commander_code || !name) {
      return new Response(
        JSON.stringify({ success: false, error: 'commander_code and name required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // onboarding_code is always generated as lowercase hex
    // (auto_generate_onboarding_code() trigger), but the driver app
    // uppercases whatever the user types before sending it here — a
    // case-sensitive match meant no real driver could ever register
    // with a freshly-generated code through the app's own normal flow.
    const { data: commander, error: commanderError } = await supabaseAdmin
      .from('pod_commanders')
      .select('id, user_id, territory_id, status')
      .eq('onboarding_code', String(commander_code).trim().toLowerCase())
      .single()

    if (commanderError || !commander) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid commander code' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (commander.status !== 'active') {
      return new Response(
        JSON.stringify({ success: false, error: 'Commander is not active' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('drivers')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (existing) {
      return new Response(
        JSON.stringify({ success: false, error: 'Already registered as driver' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: driver, error: driverError } = await supabaseAdmin
      .from('drivers')
      .insert({
        // drivers.id has no default and is NOT NULL — every other write path
        // in this codebase (e.g. admin/index.ts's toggle_driver authorize
        // upsert) treats drivers.id as equal to the driver's own auth user
        // id, never a separately-generated uuid. This insert never set it,
        // so it crashed on the not-null constraint on the very first real
        // attempt (never caught before now because the case-sensitivity bug
        // above meant no real registration ever reached this line).
        id: user.id,
        user_id: user.id,
        name,
        phone_number: phone_number || null,
        vehicle_model: vehicle_model || null,
        plate_number: plate_number || null,
        vehicle_type: vehicle_type || 'standard',
        status: 'offline',
        verified_status: 'pending',
        is_verified: false,
        territory_id: commander.territory_id,
        // PAY ATTRIBUTION. This is the "signed them up" record the 2%
        // commander revshare follows. compute_ride_split pays this user, and
        // ONLY while they still hold an active pod_commanders row — a
        // handoff, suspension or exit stops the 2% and the driver keeps the
        // full 80%. Stored as the commander's auth user_id, NOT
        // pod_commanders.id, because a handoff DELETEs that row.
        //
        // territory_id above is a SEPARATE, deliberately independent lookup:
        // it routes zone notifications to whoever currently runs the zone.
        // Do not collapse the two.
        recruited_by_commander_user_id: commander.user_id,
        recruited_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (driverError) throw driverError

    await supabaseAdmin
      .from('profiles')
      .update({ role: 'driver' })
      .eq('id', user.id)

    // Notify the commander. send_push_notification is an EDGE FUNCTION,
    // not a database procedure — the previous supabaseAdmin.rpc(...) call
    // targeted a procedure that does not exist in that shape, so this
    // notification could never land (group6 review). Invoke it over HTTP
    // like the other server-side callers (travel/index.ts): the deployed
    // send_push_notification accepts the service-role bearer on its
    // dual-path auth and the { user_id, title, body, data } contract.
    // Fire-and-forget: the registration above is already committed, so a
    // push failure is logged and swallowed — never failed back to the
    // driver who just registered.
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    await fetch(`${supabaseUrl}/functions/v1/send_push_notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
      body: JSON.stringify({
        user_id: commander.user_id,
        title: 'New Driver Registration',
        body: `${name} registered with your commander code`,
        data: { type: 'driver_registration', driver_id: driver.id, commander_id: commander.id },
      }),
    }).then(async (res) => {
      if (!res.ok) {
        console.error(`register_driver_with_code: commander push returned ${res.status}:`, await res.text().catch(() => ''))
      }
    }).catch((err) => console.error('register_driver_with_code: commander push failed (non-fatal):', err))

    // Driver-refers-driver: separate from the mandatory commander_code above
    // (that ties the new driver to a territory; this is optional, one driver
    // crediting another). apply_referral_code validates the code, blocks
    // self-referral and reuse, and pays the signup bonus. Non-fatal: a bad or
    // absent code must never block registration.
    let referralResult: { success: boolean; error?: string } | null = null
    if (driver_referral_code && typeof driver_referral_code === 'string' && driver_referral_code.trim()) {
      const { data: referralData, error: referralError } = await supabaseAdmin
        .rpc('apply_referral_code', {
          p_referee_id: user.id,
          p_code: driver_referral_code.trim().toUpperCase(),
          p_type: 'driver',
        })
      if (referralError) {
        console.error('apply_referral_code failed (non-fatal):', referralError)
      } else {
        referralResult = referralData as { success: boolean; error?: string }
      }
    }

    return new Response(
      JSON.stringify({ success: true, driver, commander_id: commander.id, referral: referralResult }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('register_driver_with_code error:', err)
    if (err instanceof Response) return err
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
