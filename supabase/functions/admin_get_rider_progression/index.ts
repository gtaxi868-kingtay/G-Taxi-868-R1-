// supabase/functions/admin_get_rider_progression/index.ts
// Returns all riders' progression data joined with profile info.
// Admin-only — requires verified admin role via requireAdmin().

import { requireAdmin } from '../_shared/auth.ts'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const LEVEL_LABELS: Record<number, string> = {
    1: 'New Rider',
    2: 'Regular',
    3: 'Power User',
    4: 'Loyalist',
    5: 'G-Escape',
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { supabaseAdmin } = await requireAdmin(req)

        const { data: progression, error: progError } = await supabaseAdmin
            .from('rider_progression')
            .select(`
                rider_id,
                level,
                total_rides,
                total_grocery_orders,
                total_laundry_orders,
                wallet_ever_funded,
                escape_ever_booked,
                unlocked_verticals,
                updated_at
            `)
            .order('level', { ascending: false })
            .order('total_rides', { ascending: false })

        if (progError) {
            console.error('[admin_get_rider_progression] progression query error:', progError)
            return new Response(JSON.stringify({ error: progError.message }), {
                status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
        }

        if (!progression?.length) {
            return new Response(JSON.stringify({ data: [] }), {
                status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
        }

        const riderIds = progression.map(p => p.rider_id)
        const { data: profiles } = await supabaseAdmin
            .from('profiles')
            .select('id, name, email')
            .in('id', riderIds)

        const { data: configs } = await supabaseAdmin
            .from('progression_config')
            .select('level, threshold_type, threshold_value, unlock_verticals, push_title')
            .order('level', { ascending: true })

        const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]))

        const enriched = progression.map(row => {
            const profile = profileMap[row.rider_id] || {}
            const levelLabel = LEVEL_LABELS[row.level] || `Level ${row.level}`

            const nextConfig = configs?.find(c => c.level > row.level)
            let next_unlock = null
            if (nextConfig) {
                let progress = 0
                switch (nextConfig.threshold_type) {
                    case 'rides':          progress = row.total_rides; break
                    case 'grocery_orders': progress = row.total_grocery_orders; break
                    case 'laundry_orders': progress = row.total_laundry_orders; break
                    case 'wallet_funded':  progress = row.wallet_ever_funded ? 1 : 0; break
                    case 'escape_booked':  progress = row.escape_ever_booked ? 1 : 0; break
                }
                next_unlock = {
                    verticals: nextConfig.unlock_verticals,
                    progress,
                    required: nextConfig.threshold_value,
                    label: nextConfig.push_title || nextConfig.unlock_verticals.join(', '),
                }
            }

            return {
                rider_id: row.rider_id,
                name: profile.name || null,
                email: profile.email || null,
                level: row.level,
                level_label: levelLabel,
                total_rides: row.total_rides,
                total_grocery_orders: row.total_grocery_orders,
                total_laundry_orders: row.total_laundry_orders,
                wallet_ever_funded: row.wallet_ever_funded,
                escape_ever_booked: row.escape_ever_booked,
                unlocked_verticals: row.unlocked_verticals || [],
                next_unlock,
            }
        })

        return new Response(JSON.stringify({ data: enriched }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    } catch (err) {
        if (err instanceof Response) return err
        console.error('[admin_get_rider_progression] error:', err)
        return new Response(JSON.stringify({ error: 'Internal error' }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }
})
