import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const { email, password, full_name } = await req.json()

    if (!email || !password || !full_name) {
      return new Response(
        JSON.stringify({ success: false, error: 'email, password, and full_name are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: authUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role: 'merchant' },
    })

    if (createError) throw createError

    const { data: merchant, error: mErr } = await supabaseAdmin
      .from('merchants')
      .insert({ name: full_name, created_by: authUser.user.id })
      .select('id')
      .single()

    if (mErr) throw mErr

    const { error: pErr } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: authUser.user.id,
        full_name,
        email,
        merchant_id: merchant.id,
        role: 'merchant',
      }, { onConflict: 'id' })

    if (pErr) throw pErr

    return new Response(
      JSON.stringify({
        success: true,
        user_id: authUser.user.id,
        merchant_id: merchant.id,
        email,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('merchant_signup error:', err)
    const status = err instanceof Response ? err.status : 500
    const message = err instanceof Response ? null : (err.message || 'Internal error')
    if (err instanceof Response) return err
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
