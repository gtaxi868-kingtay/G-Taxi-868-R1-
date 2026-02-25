// supabase/functions/admin_cancel_ride/index.ts
// Force-sets a ride status to 'cancelled' by ride_id.
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

        const { ride_id } = await req.json()

        if (!ride_id) {
            return new Response(
                JSON.stringify({ success: false, error: 'ride_id is required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const { error } = await supabaseAdmin
            .from('rides')
            .update({ status: 'cancelled' })
            .eq('id', ride_id)

        if (error) {
            console.error('admin_cancel_ride error:', error)
            return new Response(
                JSON.stringify({ success: false, error: error.message }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        return new Response(
            JSON.stringify({ success: true, ride_id }),
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
