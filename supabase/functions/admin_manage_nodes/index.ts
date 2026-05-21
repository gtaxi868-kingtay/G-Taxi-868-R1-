import { requireAdmin } from '../_shared/auth.ts'

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
    const { supabaseAdmin } = await requireAdmin(req)
    const { action, node, node_id } = await req.json()

    switch (action) {
      case 'list': {
        const { data, error } = await supabaseAdmin
          .from('kiosk_nodes')
          .select('*, merchants(id, name, category)')
          .order('created_at', { ascending: false })

        if (error) throw error

        return new Response(
          JSON.stringify({ success: true, nodes: data }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      case 'upsert': {
        if (!node) {
          return new Response(
            JSON.stringify({ success: false, error: 'node payload required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        if (node.id) {
          const { data, error } = await supabaseAdmin
            .from('kiosk_nodes')
            .update(node)
            .eq('id', node.id)
            .select()
            .single()

          if (error) throw error

          return new Response(
            JSON.stringify({ success: true, node: data }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        const { data, error } = await supabaseAdmin
          .from('kiosk_nodes')
          .insert({
            tag_uid: node.tag_uid,
            merchant_id: node.merchant_id || null,
            location_name: node.location_name,
            lat: node.lat || null,
            lng: node.lng || null,
            default_services: node.default_services || ['ride'],
            is_active: node.is_active ?? true,
          })
          .select()
          .single()

        if (error) throw error

        return new Response(
          JSON.stringify({ success: true, node: data }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      case 'toggle_active': {
        if (!node_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'node_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        const { data: current } = await supabaseAdmin
          .from('kiosk_nodes')
          .select('is_active')
          .eq('id', node_id)
          .single()

        const { data, error } = await supabaseAdmin
          .from('kiosk_nodes')
          .update({ is_active: !current?.is_active })
          .eq('id', node_id)
          .select()
          .single()

        if (error) throw error

        return new Response(
          JSON.stringify({ success: true, node: data }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      case 'delete': {
        if (!node_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'node_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        const { error } = await supabaseAdmin
          .from('kiosk_nodes')
          .delete()
          .eq('id', node_id)

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
    console.error('admin_manage_nodes error:', err)
    const status = err instanceof Response ? err.status : 500
    const message = err instanceof Response ? null : (err.message || 'Internal error')
    if (err instanceof Response) return err
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
