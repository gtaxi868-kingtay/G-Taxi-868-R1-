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
    const { supabaseAdmin, user } = await requireAdmin(req)
    const { ride_id, driver_id } = await req.json()

    if (!ride_id || !driver_id) {
      throw new Error('ride_id and driver_id are required')
    }

    const { error } = await supabaseAdmin
      .from('rides')
      .update({ 
        driver_id,
        status: 'assigned',
        admin_override: true,
        admin_id: user.id
      })
      .eq('id', ride_id)
      .eq('status', 'searching') // Only override if still searching or needs manual intervention

    if (error) throw error

    return new Response(
      JSON.stringify({ success: true, ride_id, driver_id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('admin_assign_driver error:', err)
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
