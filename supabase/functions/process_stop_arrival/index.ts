import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

async function requireAuth(req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    throw new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!
  )

  const { data: { user }, error } = await supabaseClient.auth.getUser(
    authHeader.replace('Bearer ', '')
  )

  if (error || !user) {
    throw new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  return user
}

const STATUS_PROGRESSION: Record<string, string> = {
  driver_assigned: 'driver_picked_up',
  driver_picked_up: 'driver_en_route',
  driver_en_route: 'delivered',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const user = await requireAuth(req)

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { delivery_id, stop_id } = await req.json()

    if (!delivery_id) {
      return new Response(JSON.stringify({ error: 'delivery_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: driverRecord, error: driverError } = await supabaseAdmin
      .from('drivers')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (driverError || !driverRecord) {
      return new Response(JSON.stringify({ error: 'Not a registered driver' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const driverId = driverRecord.id

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, delivery_driver_id, delivery_status, status, actual_delivery_at')
      .eq('id', delivery_id)
      .single()

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: 'Delivery not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (order.delivery_driver_id !== driverId) {
      return new Response(JSON.stringify({ error: 'Not assigned to this delivery' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (stop_id) {
      const { data: stop, error: stopError } = await supabaseAdmin
        .from('ride_stops')
        .select('id, ride_id, status, arrived_at, stop_order')
        .eq('id', stop_id)
        .single()

      if (stopError || !stop) {
        return new Response(JSON.stringify({ error: 'Stop not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (stop.status !== 'pending') {
        return new Response(JSON.stringify({ error: 'Stop already completed or skipped' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      await supabaseAdmin
        .from('ride_stops')
        .update({ arrived_at: new Date().toISOString(), status: 'completed' })
        .eq('id', stop_id)

      return new Response(JSON.stringify({
        success: true,
        type: 'stop_arrival',
        stop_id,
        status: 'completed',
        arrived_at: new Date().toISOString(),
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const currentStatus = order.delivery_status || 'driver_assigned'
    const nextStatus = STATUS_PROGRESSION[currentStatus]

    if (!nextStatus) {
      return new Response(JSON.stringify({ error: 'No further status progression available' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const updatePayload: Record<string, any> = {
      delivery_status: nextStatus,
      status: nextStatus === 'delivered' ? 'delivered' : 'in_delivery',
    }

    if (nextStatus === 'delivered') {
      updatePayload.actual_delivery_at = new Date().toISOString()
    }

    const { error: updateError } = await supabaseAdmin
      .from('orders')
      .update(updatePayload)
      .eq('id', delivery_id)

    if (updateError) {
      return new Response(JSON.stringify({ error: 'Failed to update delivery status' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let payoutResult = null
    if (nextStatus === 'delivered') {
      const { data: payout, error: payoutError } = await supabaseAdmin
        .rpc('process_order_delivery_payment', { p_order_id: delivery_id })

      if (!payoutError && payout) {
        payoutResult = payout
      }
    }

    return new Response(JSON.stringify({
      success: true,
      type: 'delivery_progression',
      delivery_id,
      previous_status: currentStatus,
      current_status: nextStatus,
      is_delivered: nextStatus === 'delivered',
      payout: payoutResult,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('process_stop_arrival error:', err)
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
