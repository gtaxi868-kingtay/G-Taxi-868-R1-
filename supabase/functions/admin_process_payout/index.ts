// supabase/functions/admin_process_payout/index.ts
// Admin approves or rejects a driver payout request.
// Approval atomically debits the driver wallet via process_payout_request RPC.

import { requireAdmin } from '../_shared/auth.ts'

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
        const { supabaseAdmin, user } = await requireAdmin(req)
        const { request_id, action, reason } = await req.json()

        if (!request_id || !['approve', 'reject'].includes(action)) {
            return new Response(JSON.stringify({ error: 'request_id and action (approve|reject) are required' }), {
                status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
        }

        const { error } = await supabaseAdmin.rpc('process_payout_request', {
            p_request_id: request_id,
            p_action: action,
            p_admin_id: user.id,
            p_reason: reason ?? null,
        })

        if (error) {
            console.error('process_payout_request error:', error)
            return new Response(JSON.stringify({ error: error.message }), {
                status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
        }

        return new Response(JSON.stringify({ success: true, request_id, action }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    } catch (err) {
        if (err instanceof Response) return err
        console.error('admin_process_payout error:', err)
        return new Response(JSON.stringify({ error: 'Internal error' }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }
})
