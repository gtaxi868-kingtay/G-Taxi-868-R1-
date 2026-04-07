import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { verifyMerchantKey, corsHeaders } from "../_shared/merchant_auth.ts"

/**
 * Supabase Edge Function: update_order_price
 * Purpose: Handles weight-based surcharges for Grocery/Laundry orders.
 * Logic: weight_kg * 1000 (cents per kg) added to subtotal.
 */

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { merchantId } = await verifyMerchantKey(req, 'order:write')
    const { order_id, weight_kg, surcharge_cents } = await req.json()

    if (!order_id || weight_kg === undefined) throw new Error("Missing order_id or weight_kg")

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Verify Order Ownership and get current total
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, subtotal_cents, merchant_id')
      .eq('id', order_id)
      .eq('merchant_id', merchantId)
      .single()

    if (orderError || !order) throw new Error("Order not found or access denied.")

    // 2. Update Order with weight and new total
    const finalSurcharge = surcharge_cents || Math.round(weight_kg * 1000)
    const newTotal = order.subtotal_cents + finalSurcharge

    const { error: updateError } = await supabaseAdmin
      .from('orders')
      .update({ 
        weight_kg,
        total_cents: newTotal,
        surcharge_cents: finalSurcharge
      })
      .eq('id', order_id)

    if (updateError) throw updateError

    return new Response(JSON.stringify({ 
      success: true, 
      weight_kg, 
      new_total: newTotal 
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } })

  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
