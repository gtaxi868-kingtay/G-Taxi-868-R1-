// supabase/functions/admin_get_users/index.ts
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
    const { supabaseAdmin } = await requireAdmin(req)

    // 1. Fetch all profiles
    const { data: profiles, error: pErr } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, role')
      .order('created_at', { ascending: false })

    if (pErr) throw pErr

    // 2. Fetch driver user_ids
    const { data: drivers } = await supabaseAdmin.from('drivers').select('user_id')
    const driverIds = new Set((drivers || []).map(d => d.user_id))

    // 3. Fetch balances
    const { data: txs } = await supabaseAdmin.from('wallet_transactions').select('user_id, amount')
    const balances: Record<string, number> = {}
    txs?.forEach(tx => {
      balances[tx.user_id] = (balances[tx.user_id] || 0) + tx.amount
    })

    const users = (profiles || []).map(p => ({
      id: p.id,
      name: p.full_name || 'No Name',
      email: p.email || 'No Email',
      role: p.role || 'rider',
      is_driver: driverIds.has(p.id),
      balance_cents: balances[p.id] || 0,
    }))

    const lockedDrivers = users
      .filter(u => u.is_driver && u.balance_cents <= -60000)
      .map(u => ({ user_id: u.id, name: u.name, balance: u.balance_cents }))

    return new Response(
      JSON.stringify({ success: true, users, lockedDrivers }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('admin_get_users error:', err)
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
