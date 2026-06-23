import { requireAuth } from '../_shared/auth.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const user = await requireAuth(req)

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { commander_code, name, phone_number, vehicle_model, plate_number, vehicle_type } = await req.json()

    if (!commander_code || !name) {
      return new Response(
        JSON.stringify({ success: false, error: 'commander_code and name required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: commander, error: commanderError } = await supabaseAdmin
      .from('pod_commanders')
      .select('id, user_id, territory_id, status')
      .eq('onboarding_code', commander_code)
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
      })
      .select()
      .single()

    if (driverError) throw driverError

    await supabaseAdmin
      .from('profiles')
      .update({ role: 'driver' })
      .eq('id', user.id)

    await supabaseAdmin.rpc('send_push_notification', {
      p_user_id: commander.user_id,
      p_title: 'New Driver Registration',
      p_body: `${name} registered with your commander code`,
    }).maybeSingle()

    return new Response(
      JSON.stringify({ success: true, driver, commander_id: commander.id }),
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
