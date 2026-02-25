// supabase/functions/admin_settle_debt/index.ts
// Inserts a topup wallet_transaction to zero out a driver's negative balance.
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

        const { user_id, amount_cents } = await req.json()

        if (!user_id || amount_cents === undefined) {
            return new Response(
                JSON.stringify({ success: false, error: 'user_id and amount_cents are required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        if (amount_cents <= 0) {
            return new Response(
                JSON.stringify({ success: false, error: 'amount_cents must be positive' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const { error } = await supabaseAdmin
            .from('wallet_transactions')
            .insert({
                user_id,
                amount: amount_cents,
                transaction_type: 'topup',
                description: 'Admin Manual Debt Settlement',
                status: 'completed',
            })

        if (error) {
            console.error('admin_settle_debt error:', error)
            return new Response(
                JSON.stringify({ success: false, error: error.message }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        return new Response(
            JSON.stringify({ success: true, user_id, amount_cents }),
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
