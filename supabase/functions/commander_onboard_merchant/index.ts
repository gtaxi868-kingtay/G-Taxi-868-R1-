import { requireCommander } from './_shared/auth.ts'

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
    const { supabaseAdmin, commander } = await requireCommander(req)
    const { merchant_id, action } = await req.json()

    if (!merchant_id || !action) {
      return new Response(
        JSON.stringify({ success: false, error: 'merchant_id and action required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!['invite', 'activate'].includes(action)) {
      return new Response(
        JSON.stringify({ success: false, error: 'action must be invite or activate' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: merchant, error: merchError } = await supabaseAdmin
      .from('merchants')
      .select('id, name, territory_id, activation_status')
      .eq('id', merchant_id)
      .single()

    if (merchError || !merchant) {
      return new Response(
        JSON.stringify({ success: false, error: 'Merchant not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (commander.territory_id && merchant.territory_id !== commander.territory_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Merchant not in your territory' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (action === 'activate') {
      const { error: updateError } = await supabaseAdmin
        .from('merchants')
        .update({ activation_status: 'active', is_active: true })
        .eq('id', merchant_id)

      if (updateError) throw updateError

      const metrics = commander.metrics as Record<string, number>
      await supabaseAdmin
        .from('pod_commanders')
        .update({
          metrics: { ...metrics, merchants_onboarded: (metrics.merchants_onboarded || 0) + 1 },
        })
        .eq('id', commander.id)
    }

    return new Response(
      JSON.stringify({ success: true, merchant_id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('commander_onboard_merchant error:', err)
    if (err instanceof Response) return err
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})