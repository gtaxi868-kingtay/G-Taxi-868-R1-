// supabase/functions/admin_toggle_flag/index.ts
// Toggles the is_active boolean on a system_feature_flags row by id.
// Requires admin role — rejects any other caller with 403.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { requireAdmin } from '../_shared/auth.ts'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { supabaseAdmin } = await requireAdmin(req)

        const { id, is_active } = await req.json()

        if (!id || is_active === undefined) {
            return new Response(
                JSON.stringify({ success: false, error: 'id and is_active are required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Toggle: the client sends the CURRENT value, we flip it server-side.
        const { error } = await supabaseAdmin
            .from('system_feature_flags')
            .update({ is_active: !is_active })
            .eq('id', id)

        if (error) {
            console.error('admin_toggle_flag error:', error)
            return new Response(
                JSON.stringify({ success: false, error: error.message }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        return new Response(
            JSON.stringify({ success: true, id, is_active: !is_active }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (err: any) {
        if (err instanceof Response) return err
        return new Response(
            JSON.stringify({ success: false, error: err.message || 'Internal error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
