// supabase/functions/admin_verify_deposit/index.ts
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
    const { deposit_id, status, amount_cents } = await req.json()

    if (!deposit_id || !['approved', 'rejected'].includes(status)) {
        return new Response(
            JSON.stringify({ success: false, error: 'Invalid parameters' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

    const updateData: any = { 
        status, 
        updated_at: new Date().toISOString() 
    }
    
    if (amount_cents !== undefined) {
        updateData.amount_cents = amount_cents
    }

    const { data, error } = await supabaseAdmin
      .from('manual_deposits')
      .update(updateData)
      .eq('id', deposit_id)
      .select()
      .single()

    if (error) throw error

    return new Response(
      JSON.stringify({ success: true, data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('admin_verify_deposit error:', err)
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
