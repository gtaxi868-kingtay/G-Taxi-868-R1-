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
    const { ride_id } = await req.json()

    if (!ride_id) {
      throw new Error('ride_id is required')
    }

    // 1. Mark as completed and overridden
    const { error: updateError } = await supabaseAdmin
      .from('rides')
      .update({ 
        status: 'completed',
        admin_override: true,
        admin_id: user.id
      })
      .eq('id', ride_id)

    if (updateError) throw updateError

    // 2. Fetch total fare to process payment
    const { data: ride } = await supabaseAdmin
      .from('rides')
      .select('total_fare_cents')
      .eq('id', ride_id)
      .single()

    if (ride && ride.total_fare_cents) {
        // 3. Call process_wallet_payment RPC
        const { error: rpcError } = await supabaseAdmin.rpc('process_wallet_payment', {
            p_ride_id: ride_id,
            p_amount: ride.total_fare_cents
        })
        if (rpcError) {
             console.error('Forced complete. Payment processing failed:', rpcError)
             // We return success for completion but note payment failure
             return new Response(
                JSON.stringify({ success: true, ride_id, payment_processed: false, error: rpcError.message }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }
    }

    return new Response(
      JSON.stringify({ success: true, ride_id, payment_processed: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('admin_force_complete error:', err)
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
