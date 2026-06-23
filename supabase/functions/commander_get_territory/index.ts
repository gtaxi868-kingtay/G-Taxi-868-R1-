import { requireCommander } from './_shared/auth.ts'

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

    if (!commander.territory_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'No territory assigned' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: territory, error: terrError } = await supabaseAdmin
      .from('territories')
      .select('*')
      .eq('id', commander.territory_id)
      .single()

    if (terrError) throw terrError

    const { data: pucks, error: puckError } = await supabaseAdmin
      .from('kiosk_nodes')
      .select('id, location_name, lifecycle_status, battery_level, last_heartbeat, is_active')
      .eq('territory_id', commander.territory_id)

    if (puckError) throw puckError

    const { data: drivers, error: driverError } = await supabaseAdmin
      .from('drivers')
      .select('id, user_id, name, status, is_online, verified_status')
      .eq('territory_id', commander.territory_id)

    if (driverError) throw driverError

    const activePucks = pucks.filter(p => p.lifecycle_status === 'live' || p.lifecycle_status === 'activated')
    const activeDrivers = drivers.filter(d => d.is_online && d.status === 'online')

    const metrics = {
      total_pucks: pucks.length,
      active_pucks: activePucks.length,
      total_drivers: drivers.length,
      active_drivers: activeDrivers.length,
    }

    return new Response(
      JSON.stringify({
        success: true,
        territory,
        commander,
        metrics,
        pucks,
        drivers,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('commander_get_territory error:', err)
    if (err instanceof Response) return err
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
