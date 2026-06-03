import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await requireAuth(req);
    const { tag_uid, device_info } = await req.json();
    if (!tag_uid) throw new Error("Missing Tag UID");

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    await checkRateLimit(supabaseAdmin, user.id, 'nfc_restore_session');

    const { data: tag, error: tagError } = await supabaseAdmin
      .from('identity_tags')
      .select('profile_id, tag_type, is_active')
      .eq('tag_uid', tag_uid)
      .single();

    if (tagError || !tag) throw new Error("Security Violation: Invalid or unrecognized Physical Tag.");
    if (!tag.is_active) throw new Error("Security Violation: This Tag has been remotely deactivated.");

    if (tag.profile_id !== user.id) {
      throw new Error("This tag is not linked to your account.");
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('balance_cents, is_suspended, email')
      .eq('id', tag.profile_id)
      .single();

    if (profileError || !profile) throw new Error("Profile resolution failed.");
    if (profile.is_suspended) throw new Error("Account Suspended. Contact G-Taxi Admin.");
    if (profile.balance_cents < -30000) throw new Error("Global Debt Block: Level 1 Debt Detected. Settle balance to use Tap-to-Restore.");

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: profile.email,
      options: { redirectTo: 'gtaxi://restore' }
    });

    if (authError) throw authError;

    await supabaseAdmin.from('identity_tags').update({
      last_tapped_at: new Date().toISOString(),
      metadata: { ...tag.metadata, last_device: device_info }
    }).eq('tag_uid', tag_uid);

    return new Response(
      JSON.stringify({
        success: true,
        user_type: tag.tag_type,
        msg: "Identity Verified. Restoring Session..."
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    if (error instanceof Response) return error;
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
