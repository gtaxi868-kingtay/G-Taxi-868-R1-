// supabase/functions/create_order_payment_intent/index.ts
//
// The rider app's laundry flow (LaundryEstimatorScreen.tsx) has called
// supabase.functions.invoke('create_order_payment_intent', { order_id })
// since it was written — this function never existed, so every card-payment
// laundry booking failed outright. Cash-on-delivery laundry bookings worked
// (they never call this), which is why the gap sat unnoticed.
//
// Reuses grocery/index.ts's 'create_payment_intent' action verbatim as the
// pattern (manual-capture Stripe PaymentIntent, 15% authorization hold,
// idempotency key, ephemeral key for the customer, re-use of an existing
// live PaymentIntent instead of creating a duplicate) — this function is
// generic over `orders` rather than grocery-specific, so laundry (and any
// future non-grocery order type that books through the `orders` table) can
// share it instead of each vertical growing its own copy.
//
// Amount is read from the real order row (`orders.total_cents`) — never
// trusted from the client request body, same discipline as grocery's.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.0.0'
import { requireAuth } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'

function requireEnv(key: string): string {
  const value = Deno.env.get(key)
  if (!value) throw new Error(`Missing required environment variable: ${key}`)
  return value
}

const SUPABASE_URL = requireEnv('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const user = await requireAuth(req)

    const rateCheck = await checkRateLimit(supabase, user.id, 'create_order_payment_intent')
    if (!rateCheck.allowed) {
      return json({ success: false, error: rateCheck.error }, 429)
    }

    const { order_id, idempotency_key } = await req.json()
    if (!order_id) return json({ error: 'order_id is required' }, 400)

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, total_cents, rider_id, merchant_id, status, payment_status, stripe_payment_intent_id')
      .eq('id', order_id)
      .eq('rider_id', user.id)
      .single()

    if (orderError || !order) return json({ error: 'Order not found or does not belong to this user' }, 404)
    if (order.payment_status !== 'pending') {
      return json({ error: `Order payment_status is '${order.payment_status}'. Only 'pending' orders can authorize payment.` }, 409)
    }
    if (order.status !== 'pending') {
      return json({ error: `Order status is '${order.status}'. Only 'pending' orders can authorize payment.` }, 409)
    }

    const stripe = new Stripe(requireEnv('STRIPE_SECRET_KEY'))

    // Re-use a still-usable PaymentIntent instead of creating a duplicate —
    // a retry (lost network response, app backgrounded mid-sheet) must not
    // mint a second hold against the same order.
    if (order.stripe_payment_intent_id) {
      try {
        const existingPI = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id)
        if (existingPI?.client_secret && !['canceled', 'succeeded'].includes(existingPI.status)) {
          return json({ clientSecret: existingPI.client_secret, order_id: order.id })
        }
      } catch { /* create a new one below */ }
    }

    const totalCents = order.total_cents
    if (totalCents <= 0) return json({ error: 'Order total is invalid' }, 400)

    const holdCents = Math.round(totalCents * 1.15)

    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single()

    const createParams: Record<string, unknown> = {
      amount: holdCents, currency: 'ttd',
      customer: profile?.stripe_customer_id,
      setup_future_usage: 'off_session', capture_method: 'manual',
      metadata: {
        type: 'order', order_id: order.id, merchant_id: order.merchant_id ?? '',
        user_id: user.id, estimated_total_cents: String(totalCents),
      },
      payment_method_types: ['card'],
    }

    let ephemeralKeySecret: string | undefined
    if (profile?.stripe_customer_id) {
      try {
        const ephemeralKey = await stripe.ephemeralKeys.create(
          { customer: profile.stripe_customer_id },
          { apiVersion: '2023-10-16' },
        )
        ephemeralKeySecret = ephemeralKey.secret
      } catch { /* ok — payment sheet still works without one */ }
    }

    const stripeOptions: Record<string, unknown> = {}
    if (idempotency_key) stripeOptions.idempotencyKey = idempotency_key

    const paymentIntent = await stripe.paymentIntents.create(
      createParams as Parameters<typeof stripe.paymentIntents.create>[0],
      stripeOptions,
    )

    await supabase.from('orders').update({
      stripe_payment_intent_id: paymentIntent.id, authorized_hold_cents: holdCents,
    }).eq('id', order.id)

    return json({
      clientSecret: paymentIntent.client_secret, order_id: order.id,
      total_cents: totalCents, hold_cents: holdCents,
      customer: profile?.stripe_customer_id, ephemeralKey: ephemeralKeySecret,
      publishableKey: Deno.env.get('STRIPE_PUBLISHABLE_KEY'),
    })
  } catch (err) {
    if (err instanceof Response) return err
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})
