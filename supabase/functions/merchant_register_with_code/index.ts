import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { recordMerchantConsents } from '../_shared/legalVersions.ts'
import { getCorsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { business_name, email, password, commander_code, name, accepted_terms, driver_referral_code } = await req.json()

    if (!business_name || !email || !password || !commander_code) {
      return new Response(
        JSON.stringify({ success: false, error: 'business_name, email, password, and commander_code required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Merchants previously had zero consent recording of any kind — no
    // checkbox, no ledger row. This account creation cannot proceed without
    // an explicit accept, matching the rider/driver signup requirement.
    if (accepted_terms !== true) {
      return new Response(
        JSON.stringify({ success: false, error: 'You must accept the Merchant Terms, Terms of Service, and Privacy Policy to register.' }),
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

    // Record consent immediately after the account exists — see
    // merchant_signup for why this writes directly rather than through
    // record_consent()'s auth.uid()-based RPC.
    await recordMerchantConsents(
      supabaseAdmin,
      newUser.user.id,
      req.headers.get('user-agent'),
    )

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

    await supabaseAdmin.functions.invoke('send_push_notification', {
      body: {
        user_id: commander.user_id,
        title: 'New Merchant Registration',
        body: `${business_name} registered with your commander code`,
      },
    }).then(null, () => {})

    // A driver's referral link, separate from the required commander code
    // above (which assigns territory) -- this only credits the driver who
    // sent the link and the new merchant, via the same apply_referral_code
    // path already used for driver-refers-driver/rider signups. Best-effort:
    // a bad or missing code must never fail merchant account creation, which
    // has already fully succeeded by this point.
    let referral_credit: { applied: boolean; error?: string } = { applied: false }
    if (driver_referral_code && typeof driver_referral_code === 'string') {
      try {
        const { data: referralResult, error: referralError } = await supabaseAdmin
          .rpc('apply_referral_code', {
            p_referee_id: newUser.user.id,
            p_code: driver_referral_code,
            p_type: 'merchant',
          })
        if (referralError) throw referralError
        referral_credit = { applied: !!referralResult?.success, error: referralResult?.success ? undefined : referralResult?.error }
      } catch (referralErr: any) {
        console.error('merchant_register_with_code: referral credit failed (non-fatal):', referralErr)
        referral_credit = { applied: false, error: referralErr?.message || 'referral credit failed' }
      }
    }

    return new Response(
      JSON.stringify({ success: true, user_id: newUser.user.id, merchant_id: merchant.id, referral_credit }),
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
