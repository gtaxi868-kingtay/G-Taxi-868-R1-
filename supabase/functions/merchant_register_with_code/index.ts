import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
    const { business_name, email, password, commander_code, name } = await req.json()

    if (!business_name || !email || !password || !commander_code) {
      return new Response(
        JSON.stringify({ success: false, error: 'business_name, email, password, and commander_code required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: commander, error: commanderError } = await supabaseAdmin
      .from('pod_commanders')
      .select('id, user_id, territory_id, status')
      .eq('onboarding_code', commander_code)
      .single()

    if (commanderError || !commander) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid commander code' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (commander.status !== 'active') {
      return new Response(
        JSON.stringify({ success: false, error: 'Commander is not active' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: 'merchant' },
    })

    if (createError) throw createError
    if (!newUser?.user?.id) throw new Error('Failed to create user')

    const { data: merchant, error: merchantError } = await supabaseAdmin
      .from('merchants')
      .insert({
        name: business_name,
        category: 'local',
        created_by: newUser.user.id,
        territory_id: commander.territory_id,
        activation_status: 'pending',
        is_active: false,
      })
      .select()
      .single()

    if (merchantError) {
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id)
      throw merchantError
    }

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: newUser.user.id,
        full_name: name || business_name,
        email,
        role: 'merchant',
        merchant_id: merchant.id,
      })

    if (profileError) {
      await supabaseAdmin.from('merchants').delete().eq('id', merchant.id).maybeSingle()
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id)
      throw profileError
    }

    await supabaseAdmin.rpc('send_push_notification', {
      p_user_id: commander.user_id,
      p_title: 'New Merchant Registration',
      p_body: `${business_name} registered with your commander code`,
    }).maybeSingle()

    return new Response(
      JSON.stringify({ success: true, user_id: newUser.user.id, merchant_id: merchant.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('merchant_register_with_code error:', err)
    if (err instanceof Response) return err
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
