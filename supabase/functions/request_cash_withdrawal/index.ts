import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

async function requireAuth(req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    throw new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!
  )

  const { data: { user }, error } = await supabaseClient.auth.getUser(
    authHeader.replace('Bearer ', '')
  )

  if (error || !user) {
    throw new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  return user
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const user = await requireAuth(req)

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { amount_ttd, phone_number } = await req.json()

    if (!Number.isInteger(amount_ttd) || amount_ttd <= 0) {
      return new Response(JSON.stringify({ error: 'amount_ttd must be a positive integer' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!phone_number || typeof phone_number !== 'string') {
      return new Response(JSON.stringify({ error: 'phone_number is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const role = profile.role
    let walletUserId = user.id
    let userType = role

    if (role === 'driver') {
      const { data: driverRecord, error: driverError } = await supabaseAdmin
        .from('drivers')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle()

      if (driverError || !driverRecord) {
        return new Response(JSON.stringify({ error: 'Driver record not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      walletUserId = driverRecord.id
    } else if (role === 'pod_commander') {
      userType = 'pod_commander'
    } else if (role !== 'rider') {
      return new Response(JSON.stringify({ error: 'Only riders, drivers and commanders can withdraw' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const fee_ttd = Math.round(amount_ttd * 0.02)

    const { data: result, error: rpcError } = await supabaseAdmin.rpc('request_cash_withdrawal', {
      p_user_id: user.id,
      p_wallet_user_id: walletUserId,
      p_user_type: userType,
      p_amount_ttd: amount_ttd,
      p_fee_ttd: fee_ttd,
      p_phone_number: phone_number,
    })

    if (rpcError || !result?.success) {
      const msg = result?.error || rpcError?.message || 'Withdrawal request failed'
      return new Response(JSON.stringify({ error: msg }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({
      success: true,
      withdrawal_id: result.withdrawal_id,
      amount_ttd: result.amount_ttd,
      fee_ttd: result.fee_ttd,
      phone_number: result.phone_number,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('request_cash_withdrawal error:', err)
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
