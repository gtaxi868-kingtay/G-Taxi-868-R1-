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

    const {
      email, password, full_name,
      invite_token,
      bank_name, account_holder, account_number, account_type,
    } = await req.json()

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

    // If this signup came from a Commander's node invite, validate it BEFORE
    // creating any account — a bad/expired/claimed token should fail fast,
    // not leave an orphaned auth user behind.
    let invite: { id: string; kiosk_node_id: string; token: string } | null = null
    if (invite_token) {
      const { data: inviteRow, error: inviteErr } = await supabaseAdmin
        .from('merchant_invites')
        .select('id, kiosk_node_id, token, status, expires_at')
        .eq('token', invite_token)
        .maybeSingle()

      if (inviteErr || !inviteRow) {
        return new Response(
          JSON.stringify({ success: false, error: 'This invite link is invalid.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      if (inviteRow.status !== 'pending') {
        return new Response(
          JSON.stringify({ success: false, error: 'This invite has already been used.' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      if (new Date(inviteRow.expires_at).getTime() < Date.now()) {
        return new Response(
          JSON.stringify({ success: false, error: 'This invite link has expired. Ask your Commander to send a new one.' }),
          { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      invite = inviteRow
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
        name: full_name,
        category: 'local',
        created_by: newUser.user.id,
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
        full_name,
        email,
        role: 'merchant',
        merchant_id: merchant.id,
      })

    if (profileError) {
      await supabaseAdmin.from('merchants').delete().eq('id', merchant.id).maybeSingle()
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id)
      throw profileError
    }

    await supabaseAdmin
      .from('wallets')
      .insert({ user_id: newUser.user.id, balance_cents: 0 })
      .maybeSingle()

    // Optional payout details — best-effort, never blocks account creation.
    if (bank_name || account_holder || account_number) {
      const { error: payoutErr } = await supabaseAdmin
        .from('merchant_payout_accounts')
        .insert({
          merchant_id: merchant.id,
          bank_name: bank_name || null,
          account_holder: account_holder || null,
          account_number: account_number || null,
          account_type: account_type || null,
        })
      if (payoutErr) console.error('merchant_signup: payout account insert failed (non-fatal):', payoutErr.message)
    }

    // Link the invite's node to this merchant and mark it claimed. Best-effort:
    // the merchant account is already valid at this point, so a failure here
    // is surfaced as a warning, not a rollback — HQ can link it manually.
    let node_link_warning: string | null = null
    if (invite) {
      const { error: linkErr } = await supabaseAdmin
        .from('kiosk_nodes')
        .update({ merchant_id: merchant.id })
        .eq('id', invite.kiosk_node_id)

      const { error: claimErr } = await supabaseAdmin
        .from('merchant_invites')
        .update({ status: 'claimed', claimed_at: new Date().toISOString(), merchant_id: merchant.id })
        .eq('id', invite.id)

      if (linkErr || claimErr) {
        console.error('merchant_signup: invite linking failed (non-fatal):', linkErr?.message, claimErr?.message)
        node_link_warning = 'Your account was created, but we could not link it to your spot automatically. HQ will fix this.'
      }
    }

    return new Response(
      JSON.stringify({ success: true, user_id: newUser.user.id, merchant_id: merchant.id, node_link_warning }),
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
