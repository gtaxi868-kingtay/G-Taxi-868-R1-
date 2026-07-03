import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PUCK_SHARED_SECRET = Deno.env.get('PUCK_SHARED_SECRET') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-puck-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.headers.get('x-puck-secret') !== PUCK_SHARED_SECRET) {
    return new Response(
      JSON.stringify({ success: false, error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const now = Date.now()

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { tag_uid, battery_level, firmware_version, hardware_version } = await req.json()

    if (!tag_uid) {
      return new Response(
        JSON.stringify({ success: false, error: 'tag_uid required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: node, error: nodeError } = await supabaseAdmin
      .from('kiosk_nodes')
      .select('id, lifecycle_status')
      .eq('tag_uid', tag_uid)
      .single()

    if (nodeError || !node) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unknown tag_uid' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const updateData: Record<string, unknown> = {
      last_heartbeat: new Date(now).toISOString(),
    }

    if (battery_level !== undefined) {
      if (battery_level < 0 || battery_level > 100) {
        return new Response(
          JSON.stringify({ success: false, error: 'battery_level must be 0-100' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      updateData.battery_level = battery_level

      if (battery_level <= 10) {
        await supabaseAdmin.from('puck_events').insert({
          kiosk_node_id: node.id,
          event_type: 'battery_alert',
          metadata: { battery_level, tag_uid },
        }).maybeSingle()
      }
    }

    if (firmware_version !== undefined) updateData.firmware_version = firmware_version
    if (hardware_version !== undefined) updateData.hardware_version = hardware_version

    const { error: updateError } = await supabaseAdmin
      .from('kiosk_nodes')
      .update(updateData)
      .eq('id', node.id)

    if (updateError) throw updateError

    await supabaseAdmin.from('puck_events').insert({
      kiosk_node_id: node.id,
      event_type: 'heartbeat',
      metadata: { battery_level, firmware_version, hardware_version },
    }).maybeSingle()

    return new Response(
      JSON.stringify({ success: true, timestamp: updateData.last_heartbeat }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('puck_heartbeat error:', err)
    if (err instanceof Response) return err
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
