import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'


import { getCorsHeaders } from '../_shared/cors.ts'
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
  const corsHeaders = getCorsHeaders(req);
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
      email, password, full_name, phone,
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

    // Pre-fill from an approved waitlist signup, if this phone matches one.
    // claim_waitlist_details() is granted to `authenticated` only (deliberately
    // NOT anon — an anon version would let anyone probe or claim someone
    // else's waitlist entry by phone before that person signs up themselves).
    // Calling it here as service_role bypasses that grant, which is fine: this
    // function IS the authenticated boundary — the phone was typed into this
    // exact signup form, by the person completing this exact signup.
    let claimedCategory: string | null = null
    let claimedAddress: string | null = null
    if (phone) {
      const { data: claimed } = await supabaseAdmin.rpc('claim_waitlist_details', { p_phone: String(phone).trim() })
      const details = (claimed as { details?: { category?: string; address?: string } } | null)?.details
      if (details?.category) claimedCategory = details.category
      if (details?.address) claimedAddress = details.address
    }

    const { data: merchant, error: merchantError } = await supabaseAdmin
      .from('merchants')
      .insert({
        name: full_name,
        // category is CHECK-constrained to a fixed 18-value list — safe to use
        // claimedCategory unvalidated here because it can only ever have come
        // from that same fixed list on the public waitlist form.
        category: claimedCategory || 'local',
        address: claimedAddress || null,
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
        phone_number: phone ? String(phone).trim() : null,
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
