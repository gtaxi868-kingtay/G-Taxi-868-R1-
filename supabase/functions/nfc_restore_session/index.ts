import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { tag_uid, device_info } = await req.json()
    if (!tag_uid) throw new Error("Missing Tag UID")

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Resolve Tag to Profile
    const { data: tag, error: tagError } = await supabaseAdmin
      .from('identity_tags')
      .select('profile_id, tag_type, is_active')
      .eq('tag_uid', tag_uid)
      .single()

    if (tagError || !tag) throw new Error("Security Violation: Invalid or unrecognized Physical Tag.")
    if (!tag.is_active) throw new Error("Security Violation: This Tag has been remotely deactivated.")

    // 2. Check Global Guard Rail (Debt)
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('balance_cents, is_suspended')
      .eq('id', tag.profile_id)
      .single()

    if (profileError || !profile) throw new Error("Profile resolution failed.")
    if (profile.is_suspended) throw new Error("Account Suspended. Contact G-Taxi Admin.")
    if (profile.balance_cents < -5000) throw new Error("Global Debt Block: Level 1 Debt Detected. Settle balance to use Tap-to-Restore.")

    // 3. Generate Secure Recovery Link / Session
    // We use the admin magic link generator but return it directly to the app
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: (await supabaseAdmin.from('profiles').select('email').eq('id', tag.profile_id).single()).data?.email ?? '',
      options: { redirectTo: 'gtaxi://restore' }
    })

    if (authError) throw authError

    // 4. Log the tap event
    await supabaseAdmin.from('identity_tags').update({
      last_tapped_at: new Date().toISOString(),
      metadata: { ...tag.metadata, last_device: device_info }
    }).eq('tag_uid', tag_uid)

    return new Response(
      JSON.stringify({ 
        success: true, 
        restore_url: authData.properties.action_link,
        user_type: tag.tag_type,
        msg: "Identity Verified. Restoring Galactic Session..."
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )

  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
