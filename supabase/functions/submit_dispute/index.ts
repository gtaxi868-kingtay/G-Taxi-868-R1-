// supabase/functions/submit_dispute/index.ts
// Riders and drivers file disputes / refund requests / complaints.
// Identity from JWT; ride ownership verified; simple per-day rate limit.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth } from '../_shared/auth.ts'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const CATEGORIES = [
    'refund_request', 'overcharge', 'driver_behavior', 'rider_behavior',
    'lost_item', 'safety', 'app_issue', 'other',
]

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const user = await requireAuth(req)

        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        )

        const { ride_id, category, description } = await req.json()

        if (!CATEGORIES.includes(category)) {
            return new Response(JSON.stringify({ error: 'Invalid category' }), {
                status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
        }
        const text = String(description ?? '').trim()
        if (text.length < 5 || text.length > 2000) {
            return new Response(JSON.stringify({ error: 'Description must be 5-2000 characters' }), {
                status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
        }

        // Rate limit: max 5 tickets per 24h per user
        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        const { count } = await supabaseAdmin
            .from('support_tickets')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .gte('created_at', dayAgo)
        if ((count ?? 0) >= 5) {
            return new Response(JSON.stringify({ error: 'Too many reports today. Please email support@gtaxi.tt.' }), {
                status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
        }

        // If a ride is referenced, the reporter must be a party to it
        if (ride_id) {
            const { data: ride } = await supabaseAdmin
                .from('rides')
                .select('rider_id, driver_id')
                .eq('id', ride_id)
                .single()
            if (!ride || (ride.rider_id !== user.id && ride.driver_id !== user.id)) {
                return new Response(JSON.stringify({ error: 'Ride not found' }), {
                    status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                })
            }
        }

        const { data: ticket, error } = await supabaseAdmin
            .from('support_tickets')
            .insert({
                user_id: user.id,
                ride_id: ride_id ?? null,
                category,
                description: text,
            })
            .select('id, status, created_at')
            .single()

        if (error) throw error

        return new Response(JSON.stringify({ success: true, ticket }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    } catch (err) {
        if (err instanceof Response) return err
        console.error('submit_dispute error:', err)
        return new Response(JSON.stringify({ error: 'Internal error' }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }
})
