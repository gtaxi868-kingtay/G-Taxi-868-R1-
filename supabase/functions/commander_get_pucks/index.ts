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

    let query = supabaseAdmin
      .from('kiosk_nodes')
      .select('*, merchant:merchant_id(id, name, category)')

    if (commander.territory_id) {
      query = query.eq('territory_id', commander.territory_id)
    }

    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) throw error

    return new Response(
      JSON.stringify({ success: true, nodes: data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('commander_get_pucks error:', err)
    if (err instanceof Response) return err
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
