import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.0.0'
import { requireAuth } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function requireEnv(key: string): string {
  const value = Deno.env.get(key)
  if (!value) throw new Error(`Missing required environment variable: ${key}`)
  return value
}

const SUPABASE_URL = requireEnv('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const user = await requireAuth(req)
    const body = await req.json()
    const { action } = body

    // ─── GET NEARBY STORES ─────────────────────────────────────
    if (action === 'get_nearby_stores') {
      const { lat, lng, radius_km = 10, store_type = 'grocery' } = body
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return json({ error: 'lat and lng must be numbers' }, 400)
      }

      const { data: stores, error } = await supabase
        .rpc('get_nearby_merchants', {
          p_lat: lat, p_lng: lng,
          p_radius_km: radius_km, p_store_type: store_type,
        })

      if (error || !stores) {
        const { data: fallbackStores, error: fallbackError } = await supabase
          .from('merchants')
          .select('id, name, store_type, lat, lng, address, delivery_fee_cents, minimum_order_cents, avg_delivery_minutes, cover_image_url, is_open, opens_at, closes_at')
          .eq('store_type', store_type)
          .eq('is_active', true)
          .eq('activation_status', 'active')

        if (fallbackError) throw fallbackError

        const withDistance = (fallbackStores || []).map((store: any) => {
          const dx = (store.lng - lng) * 111.32 * Math.cos(lat * Math.PI / 180) * 1000
          const dy = (store.lat - lat) * 110.574 * 1000
          const distance = Math.sqrt(dx * dx + dy * dy)
          return { ...store, distance_meters: Math.round(distance) }
        }).filter((s: any) => s.distance_meters <= radius_km * 1000)
          .sort((a: any, b: any) => a.distance_meters - b.distance_meters)

        return json({ success: true, stores: withDistance, count: withDistance.length })
      }

      return json({ success: true, stores: stores || [], count: stores?.length || 0 })
    }

    // ─── GET CATALOGUE ─────────────────────────────────────────
    if (action === 'get_catalogue') {
      const { merchant_id } = body
      if (!merchant_id) return json({ error: 'merchant_id is required' }, 400)

      const { data: merchant, error: merchantError } = await supabase
        .from('merchants')
        .select('id, name, is_active, activation_status')
        .eq('id', merchant_id)
        .eq('is_active', true)
        .eq('activation_status', 'active')
        .single()

      if (merchantError || !merchant) {
        return json({ error: 'Merchant not found or inactive' }, 404)
      }

      const { data: categories, error: catError } = await supabase
        .from('product_categories')
        .select('*')
        .eq('merchant_id', merchant_id)
        .eq('is_active', true)
        .order('display_order')

      if (catError) throw catError

      const { data: products, error: prodError } = await supabase
        .from('products')
        .select('*')
        .eq('merchant_id', merchant_id)
        .order('is_featured', { ascending: false })
        .order('created_at')

      if (prodError) throw prodError

      const catalogueCategories = (categories || []).map((cat: any) => {
        const catProducts = (products || [])
          .filter((p: any) => p.category_id === cat.id)
          .map((p: any) => ({
            id: p.id, name: p.name, description: p.description,
            price_cents: p.price_cents, compare_price_cents: p.compare_price_cents,
            image_url: p.image_url, unit: p.unit, weight_grams: p.weight_grams,
            is_available: p.is_available, is_featured: p.is_featured,
            stock_count: p.stock_count, sku: p.sku,
          }))
        return {
          id: cat.id, name: cat.name, display_order: cat.display_order,
          icon_url: cat.icon_url, product_count: catProducts.length, products: catProducts,
        }
      })

      return json({
        success: true,
        data: { merchant_id: merchant.id, merchant_name: merchant.name, categories: catalogueCategories },
      })
    }

    // ─── GET CART ──────────────────────────────────────────────
    if (action === 'get_cart') {
      const { merchant_id } = body
      if (!merchant_id) return json({ error: 'merchant_id is required' }, 400)

      const { data: merchant } = await supabase
        .from('merchants')
        .select('delivery_fee_cents, minimum_order_cents')
        .eq('id', merchant_id)
        .eq('is_active', true)
        .eq('activation_status', 'active')
        .single()

      if (!merchant) return json({ error: 'Merchant not found or inactive' }, 404)

      const { data: cartItems } = await supabase
        .from('cart_items')
        .select('id, product_id, quantity, unit_price_cents')
        .eq('user_id', user.id)
        .eq('merchant_id', merchant_id)

      if (!cartItems || cartItems.length === 0) {
        return json({
          success: true,
          cart: {
            items: [], subtotal_cents: 0,
            delivery_fee_cents: merchant.delivery_fee_cents, total_cents: 0,
            minimum_order_met: 0 >= merchant.minimum_order_cents,
            minimum_order_cents: merchant.minimum_order_cents,
          },
        })
      }

      const productIds = cartItems.map((item: any) => item.product_id)
      const { data: currentProducts } = await supabase
        .from('products')
        .select('id, name, price_cents, image_url')
        .in('id', productIds)

      const productMap = new Map(currentProducts?.map((p: any) => [p.id, p]) || [])

      let subtotal = 0
      const items = cartItems.map((item: any) => {
        const product = productMap.get(item.product_id)
        const currentPrice = product?.price_cents || item.unit_price_cents
        const lineTotal = currentPrice * item.quantity
        subtotal += lineTotal
        return {
          id: item.id, product_id: item.product_id,
          product_name: product?.name || 'Unknown Product',
          quantity: item.quantity, added_price_cents: item.unit_price_cents,
          current_price_cents: currentPrice,
          price_changed: currentPrice !== item.unit_price_cents,
          line_total_cents: lineTotal, image_url: product?.image_url || null,
        }
      })

      const deliveryFee = merchant.delivery_fee_cents
      return json({
        success: true,
        cart: {
          items, subtotal_cents: subtotal, delivery_fee_cents: deliveryFee,
          total_cents: subtotal + deliveryFee,
          minimum_order_met: subtotal >= merchant.minimum_order_cents,
          minimum_order_cents: merchant.minimum_order_cents,
        },
      })
    }

    // ─── MANAGE CART ───────────────────────────────────────────
    if (action === 'manage_cart') {
      const cartAction = body.cart_action
      const { merchant_id, product_id, quantity } = body

      if (!cartAction || !merchant_id) {
        return json({ error: 'cart_action and merchant_id are required' }, 400)
      }

      const { data: merchant } = await supabase
        .from('merchants')
        .select('id')
        .eq('id', merchant_id)
        .eq('is_active', true)
        .eq('activation_status', 'active')
        .single()

      if (!merchant) return json({ error: 'Merchant not found or inactive' }, 404)

      if (cartAction === 'clear') {
        await supabase.from('cart_items').delete().eq('user_id', user.id)
      } else if (cartAction === 'add' || cartAction === 'update') {
        if (!product_id || !quantity || quantity <= 0) {
          return json({ error: 'product_id and quantity > 0 are required' }, 400)
        }

        const { data: existingCart } = await supabase
          .from('cart_items')
          .select('merchant_id')
          .eq('user_id', user.id)
          .limit(1)

        if (existingCart?.length && existingCart[0].merchant_id !== merchant_id) {
          return json({ error: 'Cart already contains items from a different merchant. Clear cart first.' }, 400)
        }

        const { data: product } = await supabase
          .from('products')
          .select('id, price_cents, is_available')
          .eq('id', product_id)
          .eq('merchant_id', merchant_id)
          .eq('is_available', true)
          .single()

        if (!product) {
          return json({ error: 'Product not found, unavailable, or not from this merchant' }, 404)
        }

        const { error: upsertError } = await supabase
          .from('cart_items')
          .upsert({
            user_id: user.id, merchant_id, product_id, quantity,
            unit_price_cents: product.price_cents,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })

        if (upsertError) throw upsertError
      } else if (cartAction === 'remove') {
        if (!product_id) return json({ error: 'product_id is required for remove' }, 400)

        await supabase
          .from('cart_items')
          .delete()
          .eq('user_id', user.id)
          .eq('product_id', product_id)
      } else {
        return json({ error: `Unknown cart_action: ${cartAction}` }, 400)
      }

      const { data: cartItems } = await supabase
        .from('cart_items')
        .select('*')
        .eq('user_id', user.id)
        .eq('merchant_id', merchant_id)

      const subtotal = (cartItems || []).reduce((sum, item) => sum + item.unit_price_cents * item.quantity, 0)

      return json({
        success: true,
        cart: { item_count: cartItems?.length || 0, subtotal_cents: subtotal, items: cartItems || [] },
      })
    }

    // ─── PLACE ORDER ───────────────────────────────────────────
    if (action === 'place_order') {
      const {
        merchant_id, delivery_address, delivery_lat, delivery_lng,
        delivery_notes, payment_method, substitution_policy = 'contact',
      } = body

      if (!merchant_id || !delivery_address || delivery_lat == null || delivery_lng == null || !payment_method) {
        return json({ error: 'Missing required fields' }, 400)
      }
      if (!['card', 'wallet', 'cash'].includes(payment_method)) {
        return json({ error: 'Invalid payment_method' }, 400)
      }

      const { data: cartItems } = await supabase
        .from('cart_items')
        .select('*')
        .eq('user_id', user.id)
        .eq('merchant_id', merchant_id)

      if (!cartItems?.length) return json({ error: 'Cart is empty' }, 400)

      const { data: merchant } = await supabase
        .from('merchants')
        .select('delivery_fee_cents, minimum_order_cents')
        .eq('id', merchant_id)
        .eq('is_active', true)
        .eq('activation_status', 'active')
        .single()

      if (!merchant) return json({ error: 'Merchant not found or inactive' }, 404)

      const subtotal = cartItems.reduce((sum, item) => sum + item.unit_price_cents * item.quantity, 0)
      const deliveryFee = merchant.delivery_fee_cents
      const total = subtotal + deliveryFee

      if (subtotal < merchant.minimum_order_cents) {
        return json({
          error: `Order does not meet minimum. Required: ${merchant.minimum_order_cents} cents, Got: ${subtotal} cents`,
        }, 400)
      }

      if (payment_method === 'wallet') {
        const { data: balanceResult } = await supabase.rpc('get_wallet_balance', { p_user_id: user.id })
        const balance = typeof balanceResult === 'number' ? balanceResult : (balanceResult?.[0]?.balance ?? balanceResult?.balance ?? 0)
        if (balance < total) {
          return json({ error: 'Insufficient wallet balance', required: total, available: balance }, 402)
        }
      }

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          rider_id: user.id, merchant_id, status: 'pending', total_cents: total,
          delivery_fee_cents: deliveryFee, payment_method,
          delivery_method: 'courier', delivery_address, delivery_lat, delivery_lng,
          delivery_notes: delivery_notes || null, substitution_policy,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        })
        .select('*')
        .single()

      if (orderError || !order) throw orderError

      const { error: itemsError } = await supabase
        .from('order_items')
        .insert(cartItems.map((item: any) => ({
          order_id: order.id, product_id: item.product_id,
          quantity: item.quantity, unit_price_cents: item.unit_price_cents,
        })))

      if (itemsError) throw itemsError

      if (payment_method === 'cash') {
        await supabase.from('orders').update({
          payment_status: 'cash_on_delivery', status: 'confirmed',
        }).eq('id', order.id)
        await supabase.from('cart_items').delete().eq('user_id', user.id).eq('merchant_id', merchant_id)

        return json({
          success: true,
          order: { order_id: order.id, total_cents: total, payment_method: 'cash', status: 'confirmed' },
        })
      }

      if (payment_method === 'card') {
        const stripe = new Stripe(requireEnv('STRIPE_SECRET_KEY'))
        const paymentIntent = await stripe.paymentIntents.create({
          amount: total, currency: 'ttd',
          metadata: { order_id: order.id, rider_id: user.id, merchant_id },
        })

        await supabase.from('orders').update({
          stripe_payment_intent_id: paymentIntent.id, payment_status: 'pending',
        }).eq('id', order.id)

        return json({
          success: true,
          order: {
            order_id: order.id, total_cents: total, payment_method: 'card',
            client_secret: paymentIntent.client_secret, status: 'pending_payment',
          },
        })
      }

      const { error: walletError } = await supabase.rpc('deduct_wallet_balance', {
        p_user_id: user.id, p_amount_cents: total,
        p_reason: `Grocery order ${order.id}`, p_order_id: order.id,
      })

      if (walletError) {
        await supabase.from('orders').update({ status: 'cancelled', payment_status: 'failed' }).eq('id', order.id)
        const insufficient = String(walletError.message || '').includes('INSUFFICIENT_FUNDS')
        return json({
          success: false,
          error: insufficient ? 'Insufficient wallet balance for this order.' : 'Wallet payment failed.',
        }, insufficient ? 402 : 500)
      }

      await supabase.from('orders').update({ payment_status: 'captured', status: 'confirmed' }).eq('id', order.id)
      await supabase.from('cart_items').delete().eq('user_id', user.id).eq('merchant_id', merchant_id)

      return json({
        success: true,
        order: { order_id: order.id, total_cents: total, payment_method: 'wallet', status: 'confirmed' },
      })
    }

    // ─── GET ORDER STATUS ──────────────────────────────────────
    if (action === 'get_order_status') {
      const { order_id } = body
      if (!order_id) return json({ error: 'order_id is required' }, 400)

      const { data: order } = await supabase
        .from('orders')
        .select('*')
        .eq('id', order_id)
        .eq('rider_id', user.id)
        .single()

      if (!order) return json({ error: 'Order not found or access denied' }, 404)

      const { data: items } = await supabase
        .from('order_items')
        .select('id, order_id, product_id, quantity, unit_price_cents, picking_status, substituted_with_id')
        .eq('order_id', order_id)

      const productIds = (items || []).map((item: any) => item.product_id).filter(Boolean)
      const { data: products } = await supabase
        .from('products')
        .select('id, name')
        .in('id', productIds)

      const productMap = new Map(products?.map((p: any) => [p.id, p.name]) || [])

      const { data: merchant } = await supabase
        .from('merchants')
        .select('name')
        .eq('id', order.merchant_id)
        .single()

      let pickerName: string | undefined
      let driverName: string | undefined

      if (order.picker_id) {
        const { data: picker } = await supabase.from('drivers').select('name').eq('id', order.picker_id).single()
        pickerName = picker?.name
      }
      if (order.delivery_driver_id) {
        const { data: driver } = await supabase.from('drivers').select('name').eq('id', order.delivery_driver_id).single()
        driverName = driver?.name
      }

      return json({
        success: true,
        order: {
          id: order.id, rider_id: order.rider_id, merchant_id: order.merchant_id,
          merchant_name: merchant?.name || 'Unknown Merchant',
          status: order.status, payment_status: order.payment_status,
          total_cents: order.total_cents,
          items: (items || []).map((item: any) => ({
            id: item.id, product_id: item.product_id,
            product_name: productMap.get(item.product_id) || 'Unknown',
            quantity: item.quantity, unit_price_cents: item.unit_price_cents,
            picking_status: item.picking_status, substituted_with_id: item.substituted_with_id,
          })),
          delivery_address: order.delivery_address, delivery_lat: order.delivery_lat,
          delivery_lng: order.delivery_lng, delivery_notes: order.delivery_notes,
          substitution_policy: order.substitution_policy,
          estimated_delivery_at: order.estimated_delivery_at,
          actual_delivery_at: order.actual_delivery_at, picker_id: order.picker_id,
          picker_name: pickerName, delivery_driver_id: order.delivery_driver_id,
          delivery_driver_name: driverName, created_at: order.created_at,
          updated_at: order.updated_at,
        },
      })
    }

    // ─── CONFIRM DELIVERY (driver hands off order, gets paid) ──
    // Identity resolved from JWT, never trusted from body — the caller must
    // BE the order's assigned delivery_driver_id, verified server-side.
    if (action === 'confirm_delivery') {
      const { order_id, photo_url } = body
      if (!order_id) return json({ error: 'order_id is required' }, 400)

      const { data: driverRow } = await supabase
        .from('drivers').select('id, user_id').eq('user_id', user.id).single()
      if (!driverRow) return json({ error: 'Not a driver' }, 403)

      const { data: order } = await supabase
        .from('orders').select('id, delivery_driver_id, merchant_id, payment_method').eq('id', order_id).single()
      if (!order) return json({ error: 'Order not found' }, 404)
      if (order.delivery_driver_id !== driverRow.id) {
        return json({ error: 'You are not the assigned driver for this order' }, 403)
      }

      // Cash orders settle through a different RPC (driver keeps the cash,
      // owes the platform its + the merchant's share) — same driver-facing
      // action, branch to the right settlement path server-side.
      if (order.payment_method === 'cash') {
        const { data: cashResult, error: cashErr } = await supabase.rpc('process_cash_delivery_settlement', {
          p_order_id: order_id,
          p_driver_user_id: driverRow.user_id,
          p_merchant_id: order.merchant_id,
          p_photo_url: photo_url ?? null,
        })
        if (cashErr) return json({ error: cashErr.message }, 500)
        if (cashResult?.success === false) return json({ error: cashResult.error }, 400)
        return json(cashResult)
      }

      const { data: result, error: rpcErr } = await supabase.rpc('process_order_delivery_payment', {
        p_order_id: order_id,
        p_photo_url: photo_url ?? null,
      })
      if (rpcErr) return json({ error: rpcErr.message }, 500)
      if (result?.success === false) return json({ error: result.error }, 400)

      return json(result)
    }

    // ─── CREATE PAYMENT INTENT ─────────────────────────────────
    if (action === 'create_payment_intent') {
      const rateCheck = await checkRateLimit(supabase, user.id, 'grocery_create_payment_intent')
      if (!rateCheck.allowed) {
        return json({ success: false, error: rateCheck.error }, 429)
      }

      const { order_id, idempotency_key } = body
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

      if (order.stripe_payment_intent_id) {
        try {
          const existingPI = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id)
          if (existingPI?.client_secret && !['canceled', 'succeeded'].includes(existingPI.status)) {
            return json({ clientSecret: existingPI.client_secret, order_id: order.id })
          }
        } catch { /* create new one */ }
      }

      const totalCents = order.total_cents
      if (totalCents <= 0) return json({ error: 'Order total is invalid' }, 400)

      const holdCents = Math.round(totalCents * 1.15)

      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', user.id)
        .single()

      const createParams: any = {
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
        } catch { /* ok */ }
      }

      const stripeOptions: any = {}
      if (idempotency_key) stripeOptions.idempotencyKey = idempotency_key

      const paymentIntent = await stripe.paymentIntents.create(createParams, stripeOptions)

      await supabase.from('orders').update({
        stripe_payment_intent_id: paymentIntent.id, authorized_hold_cents: holdCents,
      }).eq('id', order.id)

      return json({
        clientSecret: paymentIntent.client_secret, order_id: order.id,
        total_cents: totalCents, hold_cents: holdCents,
        customer: profile?.stripe_customer_id, ephemeralKey: ephemeralKeySecret,
        publishableKey: Deno.env.get('STRIPE_PUBLISHABLE_KEY'),
      })
    }

    // ─── CONFIRM AUTHORIZATION ─────────────────────────────────
    if (action === 'confirm_authorization') {
      const { order_id } = body
      if (!order_id) return json({ error: 'order_id is required' }, 400)

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('id, rider_id, payment_status, stripe_payment_intent_id')
        .eq('id', order_id)
        .eq('rider_id', user.id)
        .single()

      if (orderError || !order) return json({ error: 'Order not found or does not belong to this user' }, 404)

      if (order.payment_status === 'authorized' || order.payment_status === 'captured') {
        return json({ success: true, payment_status: order.payment_status })
      }
      if (order.payment_status !== 'pending') {
        return json({ error: `Order is in state '${order.payment_status}', cannot authorize` }, 409)
      }
      if (!order.stripe_payment_intent_id) {
        return json({ error: 'No Stripe PaymentIntent exists for this order. Call create_payment_intent first.' }, 400)
      }

      const stripe = new Stripe(requireEnv('STRIPE_SECRET_KEY'))

      let pi
      try {
        pi = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id)
      } catch {
        return json({ error: 'Failed to verify payment status with Stripe' }, 502)
      }

      if (pi.status !== 'requires_capture') {
        return json({
          error: `Payment is in state '${pi.status}'. Expected card authorization.`,
          pi_status: pi.status,
        }, 402)
      }

      const { error: updateError } = await supabase
        .from('orders')
        .update({ payment_status: 'authorized' })
        .eq('id', order.id)

      if (updateError) return json({ error: 'Failed to update order status' }, 500)

      return json({ success: true, payment_status: 'authorized', order_id: order.id })
    }

    return json({ error: `Unknown action: ${action}` }, 400)

  } catch (err: any) {
    console.error(`grocery error:`, err)
    if (err instanceof Response) return err
    return json({ success: false, error: err.message || 'Internal server error' }, 500)
  }
})
