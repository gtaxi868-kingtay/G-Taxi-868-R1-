import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export async function requireAuth(req: Request) {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
        throw new Response(JSON.stringify({ error: 'Missing authorization header' }), {
            status: 401, headers: { 'Content-Type': 'application/json' }
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
            status: 401, headers: { 'Content-Type': 'application/json' }
        })
    }

    return user
}

export async function requireDriver(req: Request, supabaseAdmin: any) {
    const user = await requireAuth(req)

    const { data: driver, error } = await supabaseAdmin
        .from('drivers')
        .select('id, status, is_online')
        .eq('id', user.id)
        .single()

    if (error || !driver) {
        throw new Response(JSON.stringify({ error: 'Not a registered driver' }), {
            status: 403, headers: { 'Content-Type': 'application/json' }
        })
    }

    return { user, driver }
}

export async function requireAdmin(req: Request) {
    const user = await requireAuth(req)

    // Use the service role key to read the profiles table server-side.
    // This bypasses RLS and ensures the role check cannot be spoofed.
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
            status: 403, headers: { 'Content-Type': 'application/json' }
        })
    }

    return { user, supabaseAdmin }
}
