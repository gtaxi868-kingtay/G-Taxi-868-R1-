// supabase/functions/admin_get_flags/index.ts
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

    const { data: flags, error: flagsError } = await supabaseAdmin
      .from('system_feature_flags')
      .select('*')
      .order('id')

    const { data: config, error: configError } = await supabaseAdmin
      .from('system_config')
      .select('*')

    if (flagsError || configError) throw flagsError || configError

    return new Response(
      JSON.stringify({ 
        success: true, 
        data: flags,
        config: config // G-TAXI HARDENING: Fix 12
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('admin_get_flags error:', err)
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
