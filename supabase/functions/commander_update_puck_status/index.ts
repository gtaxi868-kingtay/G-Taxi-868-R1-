import { requireCommander } from '../_shared/auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const VALID_LIFECYCLE_STATUSES = ['manufactured', 'assigned', 'activated', 'live', 'suspended', 'replaced']
const COMMANDER_ALLOWED_TRANSITIONS: Record<string, string[]> = {
  'assigned': ['activated'],
  'activated': ['live', 'suspended'],
  'live': ['suspended', 'replaced'],
  'suspended': ['live', 'replaced'],
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { supabaseAdmin, commander } = await requireCommander(req)
    const { node_id, lifecycle_status, firmware_version, battery_level } = await req.json()

    if (!node_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'node_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('kiosk_nodes')
      .select('id, lifecycle_status, territory_id')
      .eq('id', node_id)
      .single()

    if (fetchError || !existing) {
      return new Response(
        JSON.stringify({ success: false, error: 'Node not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (commander.territory_id && existing.territory_id !== commander.territory_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Node not in your territory' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const updateData: Record<string, unknown> = {}

    if (lifecycle_status) {
      if (!VALID_LIFECYCLE_STATUSES.includes(lifecycle_status)) {
        return new Response(
          JSON.stringify({ success: false, error: `Invalid lifecycle_status` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const allowed = COMMANDER_ALLOWED_TRANSITIONS[existing.lifecycle_status]
      if (allowed && !allowed.includes(lifecycle_status)) {
        return new Response(
          JSON.stringify({ success: false, error: `Cannot transition from ${existing.lifecycle_status} to ${lifecycle_status}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      updateData.lifecycle_status = lifecycle_status

      if (lifecycle_status === 'activated' || lifecycle_status === 'live') {
        updateData.commissioned_at = new Date().toISOString()
        updateData.is_active = true
      }
      if (lifecycle_status === 'replaced') {
        updateData.decommissioned_at = new Date().toISOString()
        updateData.is_active = false
      }
      if (lifecycle_status === 'suspended') {
        updateData.is_active = false
      }

      await supabaseAdmin.from('puck_events').insert({
        kiosk_node_id: node_id,
        event_type: 'status_change',
        metadata: { from: existing.lifecycle_status, to: lifecycle_status, changed_by: commander.user_id },
      }).maybeSingle()
    }

    if (firmware_version !== undefined) updateData.firmware_version = firmware_version
    if (battery_level !== undefined) updateData.battery_level = battery_level
    if (battery_level !== undefined) {
      updateData.last_heartbeat = new Date().toISOString()
    }

    const { data, error } = await supabaseAdmin
      .from('kiosk_nodes')
      .update(updateData)
      .eq('id', node_id)
      .select()
      .single()

    if (error) throw error

    return new Response(
      JSON.stringify({ success: true, node: data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('commander_update_puck_status error:', err)
    if (err instanceof Response) return err
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
