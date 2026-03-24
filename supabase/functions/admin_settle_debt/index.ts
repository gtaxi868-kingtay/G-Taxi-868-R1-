// supabase/functions/admin_settle_debt/index.ts
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
    const { user_id, amount_cents } = await req.json()

    if (!user_id || amount_cents === undefined) {
      throw new Error('user_id and amount_cents are required')
    }

    if (amount_cents <= 0) {
      throw new Error('amount_cents must be positive')
    }

    const { error } = await supabaseAdmin
      .from('wallet_transactions')
      .insert({
        user_id,
        amount: amount_cents,
        transaction_type: 'topup',
        description: 'Admin Manual Debt Settlement',
        status: 'completed',
      })

    if (error) throw error

    return new Response(
      JSON.stringify({ success: true, user_id, amount_cents }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('admin_settle_debt error:', err)
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
