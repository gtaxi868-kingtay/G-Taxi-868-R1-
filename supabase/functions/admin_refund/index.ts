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
    const { ride_id, reason } = await req.json()

    if (!ride_id) {
      throw new Error('ride_id is required')
    }

    // Lookup the ride fare and rider
    const { data: ride } = await supabaseAdmin
      .from('rides')
      .select('rider_id, total_fare_cents, payment_status')
      .eq('id', ride_id)
      .single()

    if (!ride || !ride.rider_id || !ride.total_fare_cents) {
        throw new Error('Ride not found or fare invalid')
    }

    if (ride.payment_status === 'refunded') {
        throw new Error('Ride is already refunded')
    }

    // Execute the administrative wallet refund via our new RPC
    const { error: rpcError } = await supabaseAdmin.rpc('admin_wallet_adjust', {
        p_user_id: ride.rider_id,
        p_amount_cents: ride.total_fare_cents,
        p_reason: 'REFUND RIDE ' + ride_id + (reason ? ' - ' + reason : ''),
        p_admin_id: user.id
    })

    if (rpcError) throw rpcError

    // Mark ride as refunded
    const { error: updateError } = await supabaseAdmin
      .from('rides')
      .update({ payment_status: 'refunded', updated_at: new Date().toISOString() })
      .eq('id', ride_id)

    if (updateError) throw updateError

    return new Response(
      JSON.stringify({ success: true, ride_id, refunded_cents: ride.total_fare_cents }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('admin_refund error:', err)
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
