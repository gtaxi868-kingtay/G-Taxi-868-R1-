// supabase/functions/admin_get_users/index.ts
// Returns all profiles joined with the drivers table to indicate
// which profiles are authorized drivers.
// Also returns wallet_transactions aggregated per user for debt computation.
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

        // 1. Fetch all profiles
        const { data: profilesData, error: profilesError } = await supabaseAdmin
            .from('profiles')
            .select('id, full_name, email')
            .order('created_at', { ascending: false })

        if (profilesError) {
            return new Response(
                JSON.stringify({ success: false, error: profilesError.message }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 2. Fetch all driver IDs
        const { data: driversData } = await supabaseAdmin
            .from('drivers')
            .select('id')

        // 3. Fetch wallet transactions to compute locked drivers
        const { data: txData } = await supabaseAdmin
            .from('wallet_transactions')
            .select('user_id, amount')

        // Aggregate balances
        const balances: Record<string, number> = {}
        if (txData) {
            txData.forEach((tx: { user_id: string; amount: number }) => {
                balances[tx.user_id] = (balances[tx.user_id] || 0) + tx.amount
            })
        }

        const driverIds = new Set((driversData || []).map((d: { id: string }) => d.id))

        const users = (profilesData || []).map((p: { id: string; full_name: string | null; email: string | null }) => ({
            id: p.id,
            name: p.full_name || 'No Name',
            email: p.email || 'No Email',
            is_driver: driverIds.has(p.id),
            balance_cents: balances[p.id] || 0,
        }))

        // Locked = drivers with balance <= -60000 cents (owes $600+ TTD)
        const lockedDrivers = users
            .filter(u => u.is_driver && u.balance_cents <= -60000)
            .map(u => ({ user_id: u.id, name: u.name, balance: u.balance_cents }))

        return new Response(
            JSON.stringify({ success: true, users, lockedDrivers }),
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
