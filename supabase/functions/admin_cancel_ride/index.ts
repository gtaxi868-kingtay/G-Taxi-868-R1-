import { requireAdmin } from '../_shared/auth.ts'
import { captureException } from '../_shared/sentry.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const CANCELLABLE_STATUSES = [
  'requested', 'searching', 'waiting_queue', 'expired',
  'assigned', 'arrived', 'scheduled',
]

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

    const { data: ride, error: rideError } = await supabaseAdmin
      .from('rides')
      .select('status, rider_id, driver_id')
      .eq('id', ride_id)
      .single()

    if (rideError || !ride) {
      throw new Error('Ride not found')
    }

    if (!CANCELLABLE_STATUSES.includes(ride.status)) {
      throw new Error(
        `Cannot cancel ride in '${ride.status}' status. ` +
        `Valid statuses: ${CANCELLABLE_STATUSES.join(', ')}`
      )
    }

    const updatePayload: Record<string, unknown> = {
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason || 'Cancelled by admin',
    }

    const { error } = await supabaseAdmin
      .from('rides')
      .update(updatePayload)
      .eq('id', ride_id)
      .in('status', CANCELLABLE_STATUSES)

    if (error) throw error

    await supabaseAdmin.from('ride_events').insert({
      ride_id: ride_id,
      event_type: 'cancelled',
      actor_type: 'admin',
      actor_id: user.id,
      metadata: {
        reason: reason || 'Cancelled by admin',
        previous_status: ride.status,
        admin_email: user.email,
      },
    }).catch((err: unknown) => console.error('Failed to log ride event:', err))

    await supabaseAdmin.rpc('log_admin_action', {
      p_admin_id: user.id,
      p_admin_email: user.email || null,
      p_action: 'admin_cancel_ride',
      p_ride_id: ride_id,
      p_previous_status: ride.status,
      p_new_status: 'cancelled',
      p_reason: reason || 'Cancelled by admin',
      p_metadata: { driver_id: ride.driver_id, rider_id: ride.rider_id },
    }).catch((err: unknown) => console.error('Failed to write audit log:', err))

    return new Response(
      JSON.stringify({
        success: true,
        ride_id,
        previous_status: ride.status,
        new_status: 'cancelled',
        reason: reason || null,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('admin_cancel_ride error:', err)
    await captureException(err, { function: 'admin_cancel_ride' })
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
