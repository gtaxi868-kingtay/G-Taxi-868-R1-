import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export async function requireAuth(req: Request) {
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

export async function requireDriver(req: Request, supabaseAdmin: any) {
    const user = await requireAuth(req)

    const { data: driver, error } = await supabaseAdmin
        .from('drivers')
        .select('id, user_id, status, is_online')
        .eq('user_id', user.id)
        .single()

    if (error || !driver) {
        throw new Response(JSON.stringify({ error: 'Not a registered driver' }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
    }

    return { user, driver }
}

export async function requireAdmin(req: Request) {
    const user = await requireAuth(req)

    const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

    if (error || profile?.role !== 'admin') {
        throw new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
    }

    return { user, supabaseAdmin }
}

export async function requireCommander(req: Request) {
  const user = await requireAuth(req)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError || profile?.role !== 'pod_commander') {
    throw new Response(JSON.stringify({ error: 'Forbidden: commander role required' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const { data: commander, error: commanderError } = await supabaseAdmin
    .from('pod_commanders')
    .select('id, user_id, territory_id, status, onboarding_code, metrics')
    .eq('user_id', user.id)
    .single()

  if (commanderError || !commander) {
    throw new Response(JSON.stringify({ error: 'Commander record not found' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  if (commander.status !== 'active') {
    throw new Response(JSON.stringify({ error: 'Commander account is not active' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  return { user, supabaseAdmin, commander }
}