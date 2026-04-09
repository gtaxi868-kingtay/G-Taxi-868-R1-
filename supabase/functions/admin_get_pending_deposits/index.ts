// supabase/functions/admin_get_pending_deposits/index.ts
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

    const { data: deposits, error } = await supabaseAdmin
      .from('manual_deposits')
      .select('*, profiles(full_name, email)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (error) throw error

    // Format for frontend (flatten profile)
    const formatted = (deposits || []).map(d => ({
        ...d,
        profiles: {
            name: d.profiles?.full_name || 'Pilot',
            email: d.profiles?.email
        }
    }))

    return new Response(
      JSON.stringify({ success: true, data: formatted }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('admin_get_pending_deposits error:', err)
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
