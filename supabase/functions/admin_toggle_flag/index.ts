// supabase/functions/admin_toggle_flag/index.ts
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
    const { id, is_active } = await req.json()

    if (!id || is_active === undefined) {
      throw new Error('id and is_active are required')
    }

    const { error } = await supabaseAdmin
      .from('system_feature_flags')
      .update({ is_active: !is_active })
      .eq('id', id)

    if (error) throw error

    return new Response(
      JSON.stringify({ success: true, id, is_active: !is_active }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('admin_toggle_flag error:', err)
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
