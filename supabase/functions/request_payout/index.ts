// supabase/functions/request_payout/index.ts
// Driver payout request — identity from JWT, balance + bank details verified
// server-side via the request_driver_payout RPC (FOR UPDATE serialized).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireDriver } from '../_shared/auth.ts'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ERROR_MESSAGES: Record<string, string> = {
    MINIMUM_PAYOUT: 'Minimum payout is $20.00 TTD.',
    BANK_DETAILS_MISSING: 'Add your bank details before requesting a payout.',
    PAYOUT_ALREADY_PENDING: 'You already have a payout request being processed.',
    INSUFFICIENT_BALANCE: 'Requested amount exceeds your available balance.',
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        )

        const { driver } = await requireDriver(req, supabaseAdmin)
        const { amount_cents } = await req.json()

        if (!Number.isInteger(amount_cents) || amount_cents <= 0) {
            return new Response(JSON.stringify({ error: 'amount_cents must be a positive integer' }), {
                status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
        }

        const { data: requestId, error } = await supabaseAdmin.rpc('request_driver_payout', {
            p_driver_id: driver.id,
            p_amount_cents: amount_cents,
        })

        if (error) {
            const code = Object.keys(ERROR_MESSAGES).find((k) => error.message?.includes(k))
            return new Response(
                JSON.stringify({ error: code ? ERROR_MESSAGES[code] : 'Payout request failed' }),
                { status: code ? 400 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        return new Response(JSON.stringify({ success: true, request_id: requestId }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    } catch (err) {
        if (err instanceof Response) return err
        console.error('request_payout error:', err)
        return new Response(JSON.stringify({ error: 'Internal error' }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }
})
