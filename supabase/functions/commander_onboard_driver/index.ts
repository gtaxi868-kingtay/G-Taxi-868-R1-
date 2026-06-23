import { requireCommander } from '../_shared/auth.ts'

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
    const { supabaseAdmin, commander } = await requireCommander(req)
    const { driver_id, action } = await req.json()

    if (!driver_id || !action) {
      return new Response(
        JSON.stringify({ success: false, error: 'driver_id and action required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!['approve', 'reject'].includes(action)) {
      return new Response(
        JSON.stringify({ success: false, error: 'action must be approve or reject' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: driver, error: driverError } = await supabaseAdmin
      .from('drivers')
      .select('id, user_id, territory_id, status, verified_status, name')
      .eq('id', driver_id)
      .single()

    if (driverError || !driver) {
      return new Response(
        JSON.stringify({ success: false, error: 'Driver not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (commander.territory_id && driver.territory_id !== commander.territory_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Driver not in your territory' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (action === 'approve') {
      const { error: updateError } = await supabaseAdmin
        .from('drivers')
        .update({
          status: 'online',
          verified_status: 'approved',
          is_verified: true,
        })
        .eq('id', driver_id)

      if (updateError) throw updateError

      const metrics = commander.metrics as Record<string, number>
      await supabaseAdmin
        .from('pod_commanders')
        .update({
          metrics: { ...metrics, drivers_onboarded: (metrics.drivers_onboarded || 0) + 1 },
        })
        .eq('id', commander.id)

      await supabaseAdmin.rpc('send_push_notification', {
        p_user_id: driver.user_id,
        p_title: 'Welcome to G-Taxi!',
        p_body: 'Your driver application has been approved by your territory commander.',
      }).maybeSingle()
    }

    const { data: updatedDriver } = await supabaseAdmin
      .from('drivers')
      .select('*')
      .eq('id', driver_id)
      .single()

    return new Response(
      JSON.stringify({ success: true, driver: updatedDriver }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('commander_onboard_driver error:', err)
    if (err instanceof Response) return err
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
