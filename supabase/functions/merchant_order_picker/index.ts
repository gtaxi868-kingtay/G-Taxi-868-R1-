import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { verifyMerchantKey, corsHeaders } from "../_shared/merchant_auth.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { merchantId } = await verifyMerchantKey(req, 'order:read')
    const { action, order_id, item_id, status, substitution_id } = await req.json()

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Verify Order Ownership
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, merchant_id')
      .eq('id', order_id)
      .eq('merchant_id', merchantId)
      .single()

    if (orderError || !order) throw new Error("Order not found or access denied.")

    if (action === 'get_manifest') {
      const { data: items } = await supabaseAdmin
        .from('order_items')
        .select('*')
        .eq('order_id', order_id)
      return new Response(JSON.stringify({ items }), { headers: { ...corsHeaders, "Content-Type": "application/json" } })
    }

    if (action === 'update_item') {
      if (!item_id || !status) throw new Error("Missing parameters")
      
      const { data: updatedItem, error } = await supabaseAdmin
        .from('order_items')
        .update({ 
          picking_status: status,
          substituted_with_id: substitution_id || null
        })
        .eq('id', item_id)
        .eq('order_id', order_id)
        .select()
        .single()

      if (error) throw error

      // If status is OUT, create a substitution proposal
      if (status === 'OUT' && substitution_id) {
        await supabaseAdmin.from('order_substitutions').insert({
          order_id,
          original_item_id: item_id,
          suggested_product_id: substitution_id,
          status: 'PENDING'
        })
      }

      return new Response(JSON.stringify({ success: true, item: updatedItem }), { headers: { ...corsHeaders, "Content-Type": "application/json" } })
    }

    throw new Error("Invalid action")

  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
