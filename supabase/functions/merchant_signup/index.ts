import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ipAttempts = new Map<string, { count: number; resetAt: number }>()

function checkIpRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = ipAttempts.get(ip)
  if (!entry || now > entry.resetAt) {
    ipAttempts.set(ip, { count: 1, resetAt: now + 60_000 })
    return true
  }
  if (entry.count >= 3) return false
  entry.count++
  return true
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders })

  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    if (!checkIpRateLimit(ip)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Too many attempts. Try again later.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { email, password, full_name } = await req.json()

    if (!email || !password || !full_name) {
      return new Response(
        JSON.stringify({ success: false, error: 'email, password, and full_name required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

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
        name: full_name,
        category: 'local',
        created_by: newUser.user.id,
        activation_status: 'pending',
        is_active: false,
      })
      .select()
      .single()

    if (merchantError) {
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id).maybeSingle()
      throw merchantError
    }

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: newUser.user.id,
        full_name,
        email,
        role: 'merchant',
        merchant_id: merchant.id,
      })

    if (profileError) {
      await supabaseAdmin.from('merchants').delete().eq('id', merchant.id).maybeSingle()
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id).maybeSingle()
      throw profileError
    }

    await supabaseAdmin
      .from('wallets')
      .insert({ user_id: newUser.user.id, balance_cents: 0 })
      .maybeSingle()

    return new Response(
      JSON.stringify({ success: true, user_id: newUser.user.id, merchant_id: merchant.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('merchant_signup error:', err)
    if (err instanceof Response) return err
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
