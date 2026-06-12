import { requireAdmin } from '../_shared/auth.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

async function resolveDriverAuthUserId(supabaseAdmin: ReturnType<typeof createClient>, driverId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('drivers')
    .select('user_id')
    .eq('id', driverId)
    .maybeSingle()
  return data?.user_id ?? null
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
      .select('rider_id, driver_id, total_fare_cents, payment_status, payment_method')
      .eq('id', ride_id)
      .single()

    if (!ride || !ride.rider_id || !ride.total_fare_cents) {
        throw new Error('Ride not found or fare invalid')
    }

    if (ride.payment_status === 'refunded') {
        throw new Error('Ride is already refunded')
    }

    // Execute the administrative wallet refund (credit rider)
    const { error: rpcError } = await supabaseAdmin.rpc('admin_wallet_adjust', {
        p_user_id: ride.rider_id,
        p_amount_cents: ride.total_fare_cents,
        p_reason: 'REFUND RIDE ' + ride_id + (reason ? ' - ' + reason : ''),
        p_admin_id: user.id
    })

    if (rpcError) throw rpcError

    // Reverse driver payout (if any)
    if (ride.driver_id && ride.payment_method !== 'cash') {
      const driverUserId = await resolveDriverAuthUserId(supabaseAdmin, ride.driver_id)
      if (driverUserId) {
        const { data: driverPayments } = await supabaseAdmin
          .from('wallet_transactions')
          .select('amount')
          .eq('ride_id', ride_id)
          .eq('transaction_type', 'driver_payout')
          .limit(1)

        if (driverPayments && driverPayments.length > 0) {
          const payoutAmount = Math.abs(driverPayments[0].amount)
          await supabaseAdmin.rpc('admin_wallet_adjust', {
            p_user_id: driverUserId,
            p_amount_cents: -payoutAmount,
            p_reason: 'CLAWBACK: driver payout reversed for refund of ride ' + ride_id,
            p_admin_id: user.id
          }).catch(err => console.error('Driver payout clawback failed:', err))
        }
      }
    }

    // Release capital reserve (if locked)
    await supabaseAdmin
      .from('capital_reserve_ledger')
      .update({ status: 'released', notes: `Released on refund by admin ${user.id}` })
      .eq('ride_id', ride_id)
      .eq('status', 'locked')
      .catch(err => console.error('Capital reserve release failed:', err))

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
