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
    const { action, successor_id, priority, notes } = await req.json()

    if (!commander.territory_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'No territory assigned' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    switch (action) {
      case 'list': {
        const { data, error } = await supabaseAdmin
          .from('territory_successors')
          .select('*, successor:successor_id(id, email, full_name)')
          .eq('territory_id', commander.territory_id)
          .eq('is_active', true)
          .order('priority', { ascending: true })

        if (error) throw error

        return new Response(
          JSON.stringify({ success: true, successors: data }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      case 'set': {
        if (!successor_id || !priority) {
          return new Response(
            JSON.stringify({ success: false, error: 'successor_id and priority required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        if (priority < 1 || priority > 3) {
          return new Response(
            JSON.stringify({ success: false, error: 'priority must be 1, 2, or 3' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        if (successor_id === commander.user_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'Cannot set yourself as successor' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        const { data: successorProfile, error: profileError } = await supabaseAdmin
          .from('profiles')
          .select('id, role, email, full_name')
          .eq('id', successor_id)
          .single()

        if (profileError || !successorProfile) {
          return new Response(
            JSON.stringify({ success: false, error: 'Successor profile not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        if (successorProfile.role === 'pod_commander') {
          return new Response(
            JSON.stringify({ success: false, error: 'Successor is already a commander' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        const { data: successorDriver } = await supabaseAdmin
          .from('drivers')
          .select('id, territory_id, rank')
          .eq('user_id', successor_id)
          .maybeSingle()

        const { data, error } = await supabaseAdmin
          .from('territory_successors')
          .upsert({
            territory_id: commander.territory_id,
            successor_id,
            successor_driver_id: successorDriver?.id || null,
            priority,
            status: 'pending',
            notes: notes || null,
            is_active: true,
          }, {
            onConflict: 'territory_id, priority',
            ignoreDuplicates: false,
          })
          .select('*, successor:successor_id(id, email, full_name)')
          .single()

        if (error) throw error

        return new Response(
          JSON.stringify({ success: true, successor: data }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      case 'confirm': {
        if (!successor_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'successor_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        const { data, error } = await supabaseAdmin
          .from('territory_successors')
          .update({
            status: 'confirmed',
            confirmed_at: new Date().toISOString(),
            confirmed_by: commander.user_id,
          })
          .eq('territory_id', commander.territory_id)
          .eq('successor_id', successor_id)
          .select('*, successor:successor_id(id, email, full_name)')
          .single()

        if (error) throw error

        return new Response(
          JSON.stringify({ success: true, successor: data }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      case 'remove': {
        if (!successor_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'successor_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        const { error } = await supabaseAdmin
          .from('territory_successors')
          .update({ is_active: false, status: 'declined' })
          .eq('territory_id', commander.territory_id)
          .eq('successor_id', successor_id)

        if (error) throw error

        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
  } catch (err: any) {
    console.error('commander_set_successor error:', err)
    if (err instanceof Response) return err
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
