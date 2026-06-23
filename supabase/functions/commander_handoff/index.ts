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
    const { to_user_id, reason } = await req.json()

    if (!to_user_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'to_user_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (to_user_id === commander.user_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Cannot hand off to yourself' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const territoryId = commander.territory_id
    if (!territoryId) {
      return new Response(
        JSON.stringify({ success: false, error: 'No territory assigned' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: successorProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, role, full_name')
      .eq('id', to_user_id)
      .single()

    if (profileError || !successorProfile) {
      return new Response(
        JSON.stringify({ success: false, error: 'Successor profile not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: territory, error: terrError } = await supabaseAdmin
      .from('territories')
      .select('name')
      .eq('id', territoryId)
      .single()

    if (terrError) throw terrError

    const { data: existingCommander } = await supabaseAdmin
      .from('pod_commanders')
      .select('id, territory_id')
      .eq('user_id', to_user_id)
      .maybeSingle()

    if (existingCommander) {
      return new Response(
        JSON.stringify({ success: false, error: 'Target user is already a commander' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: successorDriver } = await supabaseAdmin
      .from('drivers')
      .select('id')
      .eq('user_id', to_user_id)
      .maybeSingle()

    await supabaseAdmin
      .from('promotion_log')
      .insert({
        driver_id: successorDriver?.id || null,
        to_rank: 'commander_candidate',
        authorized_by: commander.user_id,
        reason: 'Commander handoff: ' + (reason || 'voluntary transfer'),
        metadata: {
          handoff: true,
          from_commander: commander.user_id,
          territory_id: territoryId,
        },
      })
      .maybeSingle()

    const { data: newCommander, error: insertError } = await supabaseAdmin
      .from('pod_commanders')
      .insert({
        user_id: to_user_id,
        territory_id: territoryId,
        status: 'active',
        metrics: commander.metrics || {},
      })
      .select()
      .single()

    if (insertError) throw insertError

    await supabaseAdmin
      .from('territories')
      .update({ commander_id: to_user_id })
      .eq('id', territoryId)

    await supabaseAdmin
      .from('profiles')
      .update({ role: 'pod_commander' })
      .eq('id', to_user_id)

    await supabaseAdmin
      .from('profiles')
      .update({ role: 'driver' })
      .eq('id', commander.user_id)

    await supabaseAdmin
      .from('pod_commanders')
      .delete()
      .eq('id', commander.id)

    await supabaseAdmin
      .from('system_alerts')
      .insert({
        type: 'commander_handoff',
        severity: 'info',
        title: 'Commander handoff: ' + (territory?.name || 'unknown'),
        details: {
          from: commander.user_id,
          to: to_user_id,
          reason: reason || 'voluntary',
          territory_id: territoryId,
        },
      })
      .maybeSingle()

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Territory transferred successfully',
        new_commander: newCommander,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('commander_handoff error:', err)
    if (err instanceof Response) return err
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
