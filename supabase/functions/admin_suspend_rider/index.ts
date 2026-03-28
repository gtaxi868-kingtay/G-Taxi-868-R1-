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
    const { rider_id, suspend } = await req.json()

    if (!rider_id || suspend === undefined) {
      throw new Error('rider_id and suspend boolean are required')
    }

    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ suspended: suspend })
      .eq('id', rider_id)

    if (error) throw error

    return new Response(
      JSON.stringify({ success: true, rider_id, suspended: suspend }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('admin_suspend_rider error:', err)
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
