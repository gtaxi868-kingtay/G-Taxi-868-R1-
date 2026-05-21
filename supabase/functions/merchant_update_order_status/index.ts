import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth } from '../_shared/auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed'],
  confirmed: ['preparing'],
  preparing: ['ready_for_pickup'],
  ready_for_pickup: ['handed_off', 'delivered'],
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const user = await requireAuth(req)

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { db: { schema: 'public' } },
    )

    const { order_id, new_status } = await req.json()

    if (!order_id || !new_status) {
      return new Response(
        JSON.stringify({ success: false, error: 'order_id and new_status required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { data: merchant, error: merchantError } = await supabaseAdmin
      .from('merchants')
      .select('id')
      .eq('created_by', user.id)
      .maybeSingle()

    if (merchantError || !merchant) {
      return new Response(
        JSON.stringify({ success: false, error: 'Not a registered merchant' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, status, merchant_id')
      .eq('id', order_id)
      .single()

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ success: false, error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (order.merchant_id !== merchant.id) {
      return new Response(
        JSON.stringify({ success: false, error: 'This order does not belong to your merchant' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const allowed = ALLOWED_TRANSITIONS[order.status]
    if (!allowed || !allowed.includes(new_status)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Cannot transition from '${order.status}' to '${new_status}'. Allowed: ${(allowed || []).join(', ') || 'none'}`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('orders')
      .update({ status: new_status, updated_at: new Date().toISOString() })
      .eq('id', order_id)
      .select()
      .single()

    if (updateError) {
      return new Response(
        JSON.stringify({ success: false, error: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({ success: true, order: updated }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err: any) {
    console.error('merchant_update_order_status error:', err)
    const status = err instanceof Response ? err.status : 500
    const message = err instanceof Response ? null : (err.message || 'Internal error')
    if (err instanceof Response) return err
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
