// driver_heatmap — demand heatmap for the driver app.
//
// Aggregates recent ride pickups into ~550m grid cells and scores each cell by
// recency-decayed demand with an hour-of-week affinity boost, so a driver opening
// the app on a Friday evening sees where Friday-evening demand actually lives.
// Cancelled rides count EXTRA (unserved demand is the strongest "be here" signal).
//
// Auth: driver JWT only (resolved via drivers.user_id — never a client-supplied id).
// The result is city-wide and aggregate-only (no rider PII beyond a coarse street
// label derived from the most common pickup address in the cell), cached 10 min
// in Redis when available, recomputed on demand otherwise.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireDriver } from '../_shared/auth.ts'
import { redisCommand } from '../_shared/redis.ts'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

const CELL_DEG = 0.005            // ~550m at Trinidad's latitude
const WINDOW_DAYS = 90            // wide window; decay does the recency work
const DECAY_HALF_LIFE_DAYS = 21   // weight halves every ~3 weeks
const HOUR_AFFINITY_BONUS = 1.6   // same time-of-week demand counts extra
const CANCELLED_BONUS = 1.25      // unserved demand signal
const MAX_CELLS = 12
const CACHE_KEY = 'driver_heatmap:v1'
const CACHE_TTL_SECONDS = 600

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
}

// Hour-of-week distance on the 168h ring (Fri 18:00 is "close to" Fri 19:00 last week)
function hourOfWeek(d: Date): number {
    return d.getUTCDay() * 24 + d.getUTCHours()
}
function ringDistance(a: number, b: number): number {
    const diff = Math.abs(a - b) % 168
    return Math.min(diff, 168 - diff)
}

// Coarse label: the most common first-segment of pickup addresses in the cell.
function bestLabel(addresses: string[]): string | null {
    const counts = new Map<string, number>()
    for (const addr of addresses) {
        if (!addr) continue
        const seg = addr.split(',')[0].trim()
        if (!seg) continue
        counts.set(seg, (counts.get(seg) || 0) + 1)
    }
    let best: string | null = null
    let bestN = 0
    for (const [seg, n] of counts) {
        if (n > bestN) { best = seg; bestN = n }
    }
    return best
}

// deno-lint-ignore no-explicit-any
async function computeHeatmap(supabaseAdmin: any) {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000).toISOString()
    const { data: rides, error } = await supabaseAdmin
        .from('rides')
        .select('pickup_lat, pickup_lng, pickup_address, created_at, status')
        .gte('created_at', since)
        .not('pickup_lat', 'is', null)
        .order('created_at', { ascending: false })
        .limit(5000)
    if (error) throw new Error(`rides query failed: ${error.message}`)

    const nowHow = hourOfWeek(new Date())
    const cells = new Map<string, { lat: number; lng: number; score: number; rides: number; addresses: string[] }>()

    for (const r of rides ?? []) {
        const created = new Date(r.created_at)
        const ageDays = (Date.now() - created.getTime()) / (24 * 3600 * 1000)
        let w = Math.exp(-ageDays * Math.LN2 / DECAY_HALF_LIFE_DAYS)
        if (ringDistance(hourOfWeek(created), nowHow) <= 2) w *= HOUR_AFFINITY_BONUS
        if (r.status === 'cancelled') w *= CANCELLED_BONUS

        const latCell = Math.floor(r.pickup_lat / CELL_DEG)
        const lngCell = Math.floor(r.pickup_lng / CELL_DEG)
        const key = `${latCell}:${lngCell}`
        const cell = cells.get(key) ?? {
            lat: (latCell + 0.5) * CELL_DEG,
            lng: (lngCell + 0.5) * CELL_DEG,
            score: 0, rides: 0, addresses: [],
        }
        cell.score += w
        cell.rides += 1
        if (r.pickup_address) cell.addresses.push(r.pickup_address)
        cells.set(key, cell)
    }

    const ranked = [...cells.values()].sort((a, b) => b.score - a.score).slice(0, MAX_CELLS)
    const maxScore = ranked[0]?.score || 1
    return {
        cells: ranked.map((c) => ({
            lat: Number(c.lat.toFixed(4)),
            lng: Number(c.lng.toFixed(4)),
            score: Number((c.score / maxScore).toFixed(3)), // 0..1 relative heat
            rides: c.rides,
            label: bestLabel(c.addresses),
        })),
        window_days: WINDOW_DAYS,
        cell_meters: 550,
        generated_at: new Date().toISOString(),
    }
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

    const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    try {
        await requireDriver(req, supabaseAdmin)
    } catch (e) {
        if (e instanceof Response) return e
        return json({ error: 'Auth failed' }, 401)
    }

    try {
        // City-wide aggregate — one cache entry serves every driver.
        const cached = await redisCommand(['GET', CACHE_KEY]).catch(() => null)
        if (cached?.result) {
            return json({ ...JSON.parse(cached.result), cached: true })
        }

        const heatmap = await computeHeatmap(supabaseAdmin)
        await redisCommand(['SET', CACHE_KEY, JSON.stringify(heatmap), 'EX', String(CACHE_TTL_SECONDS)]).catch(() => null)
        return json({ ...heatmap, cached: false })
    } catch (e) {
        console.error('[driver_heatmap]', e)
        return json({ error: e instanceof Error ? e.message : 'Internal error' }, 500)
    }
})
