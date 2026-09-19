// driver_heatmap — two grid-computed maps sharing one function, because the
// project is at Supabase's 100-edge-function plan cap (confirmed live via a
// PaymentRequiredException while trying to deploy a standalone function for
// the second map below — same wall g_driver_concierge hit earlier; same fix:
// fold into an existing endpoint instead of creating a new one).
//
// type: "demand" (default) — original behavior, unchanged. Demand heatmap
// for the driver app: aggregates recent ride pickups into ~550m grid cells,
// scored by recency-decayed demand with an hour-of-week affinity boost, so a
// driver opening the app on a Friday evening sees where Friday-evening
// demand actually lives. Cancelled rides count EXTRA (unserved demand is the
// strongest "be here" signal). Auth: driver JWT only (requireDriver, exactly
// as before — this path's behavior has not changed).
//
// type: "safety" — the map view of the safety mesh's aggregate data.
// get_area_safety() (migration 20260806000000_safety_mesh_close_the_loop.sql)
// already answers "what does the record say near THIS one point" — it's what
// apps/driver/src/components/AreaSafetyCard.tsx shows as a text card for
// wherever the driver currently stands. It was never turned into something a
// rider or driver could see spread across a whole map, because a client can
// only ever call it point-by-point and the underlying zone_safety_events
// table is revoked from anon/authenticated outright (no client can query it
// directly, by design — see that migration's PRIVACY section). This computes
// the same idea over a grid instead of one point, using the exact same
// CELL_DEG grid math as the demand heatmap above, and applies
// get_area_safety's exact status classification (sos > 0 ->
// incident_reported; silent > 0 -> check_in_missed; no data -> omit the cell
// entirely; safe >= drops -> routine; else limited_data) to each cell. A
// cell with zero events is never returned — an empty map means "nothing
// logged here," not "unsafe." Auth: requireAuth (any signed-in user, rider
// or driver) — riders picking a destination benefit from the same "is this
// area routine" signal a driver gets, and nothing in this response is
// driver-specific.
//
// PRIVACY (safety path only) — same constraints as get_area_safety, extended
// to a grid: only aggregate counts and a status word per cell ever leave
// this function. No driver id, no ride id, no order id, no rider id, no
// address text. Uses the service-role client to read zone_safety_events
// directly — the same trust boundary this function already uses to read
// `rides` directly for the demand path.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth, requireDriver } from '../_shared/auth.ts'
import { redisCommand } from '../_shared/redis.ts'
import { getCorsHeaders } from '../_shared/cors.ts'

const CELL_DEG = 0.005            // ~550m at Trinidad's latitude
const WINDOW_DAYS = 90            // wide window; decay does the recency work
const DECAY_HALF_LIFE_DAYS = 21   // weight halves every ~3 weeks
const HOUR_AFFINITY_BONUS = 1.6   // same time-of-week demand counts extra
const CANCELLED_BONUS = 1.25      // unserved demand signal
const MAX_CELLS = 12
const DEMAND_CACHE_KEY = 'driver_heatmap:v1'
const SAFETY_CACHE_KEY = 'area_safety_map:v1'
const CACHE_TTL_SECONDS = 600
const DEFAULT_SAFETY_LOOKBACK_DAYS = 30

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

type SafetyStatus = 'incident_reported' | 'check_in_missed' | 'routine' | 'limited_data'

const SAFETY_STATUS_RANK: Record<SafetyStatus, number> = {
    // Highest-severity status wins when a cell has mixed signals, same
    // priority order as get_area_safety's CASE statement.
    incident_reported: 3, check_in_missed: 2, limited_data: 0, routine: 1,
}

function classifySafety(drops: number, safe: number, silent: number, sos: number): SafetyStatus | null {
    if (sos > 0) return 'incident_reported'
    if (silent > 0) return 'check_in_missed'
    if (drops + safe === 0) return null // no data — cell is omitted, not "safe" or "unsafe"
    if (safe >= Math.max(drops, 1)) return 'routine'
    return 'limited_data'
}

// deno-lint-ignore no-explicit-any
async function computeSafetyGrid(supabaseAdmin: any) {
    let lookbackDays = DEFAULT_SAFETY_LOOKBACK_DAYS
    try {
        const { data: cfg } = await supabaseAdmin
            .from('g_config').select('value').eq('key', 'zone_awareness').maybeSingle()
        if (cfg?.value?.lookback_days) lookbackDays = Number(cfg.value.lookback_days) || DEFAULT_SAFETY_LOOKBACK_DAYS
    } catch { /* keep default */ }

    const since = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000).toISOString()
    const { data: events, error } = await supabaseAdmin
        .from('zone_safety_events')
        .select('event_type, lat, lng')
        .not('lat', 'is', null)
        .not('lng', 'is', null)
        .gte('occurred_at', since)
        .limit(20000)
    if (error) throw new Error(`zone_safety_events query failed: ${error.message}`)

    const cells = new Map<string, { lat: number; lng: number; drops: number; safe: number; silent: number; sos: number }>()

    for (const e of events ?? []) {
        const latCell = Math.floor(e.lat / CELL_DEG)
        const lngCell = Math.floor(e.lng / CELL_DEG)
        const key = `${latCell}:${lngCell}`
        const cell = cells.get(key) ?? {
            lat: Number(((latCell + 0.5) * CELL_DEG).toFixed(4)),
            lng: Number(((lngCell + 0.5) * CELL_DEG).toFixed(4)),
            drops: 0, safe: 0, silent: 0, sos: 0,
        }
        if (e.event_type === 'drop_completed') cell.drops += 1
        else if (e.event_type === 'marked_safe') cell.safe += 1
        else if (e.event_type === 'no_response') cell.silent += 1
        else if (e.event_type === 'sos') cell.sos += 1
        cells.set(key, cell)
    }

    const areas = [...cells.values()]
        .map((c) => {
            const status = classifySafety(c.drops, c.safe, c.silent, c.sos)
            if (!status) return null
            return {
                lat: c.lat, lng: c.lng, status,
                drops: c.drops, marked_safe: c.safe, check_ins_missed: c.silent, sos_events: c.sos,
            }
        })
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .sort((a, b) => SAFETY_STATUS_RANK[b.status] - SAFETY_STATUS_RANK[a.status])

    return {
        areas,
        cell_meters: 550,
        lookback_days: lookbackDays,
        generated_at: new Date().toISOString(),
    }
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  function json(body: unknown, status = 200): Response {
      return new Response(JSON.stringify(body), {
          status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
  }

    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

    const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // type is only ever read from a query param — GET (driver_heatmap's
    // existing callers) and POST with an empty/JSON-less body both work the
    // same way they always did, defaulting to "demand".
    const url = new URL(req.url)
    const type = url.searchParams.get('type') === 'safety' ? 'safety' : 'demand'

    if (type === 'safety') {
        try {
            await requireAuth(req)
        } catch (e) {
            if (e instanceof Response) return e
            return json({ error: 'Auth failed' }, 401)
        }

        try {
            const cached = await redisCommand(['GET', SAFETY_CACHE_KEY]).catch(() => null)
            if (cached?.result) {
                return json({ success: true, ...JSON.parse(cached.result), cached: true })
            }
            const grid = await computeSafetyGrid(supabaseAdmin)
            await redisCommand(['SET', SAFETY_CACHE_KEY, JSON.stringify(grid), 'EX', String(CACHE_TTL_SECONDS)]).catch(() => null)
            return json({ success: true, ...grid, cached: false })
        } catch (e) {
            console.error('[driver_heatmap:safety]', e)
            return json({ success: false, error: e instanceof Error ? e.message : 'Internal error' }, 500)
        }
    }

    try {
        await requireDriver(req, supabaseAdmin)
    } catch (e) {
        if (e instanceof Response) return e
        return json({ error: 'Auth failed' }, 401)
    }

    try {
        // City-wide aggregate — one cache entry serves every driver.
        const cached = await redisCommand(['GET', DEMAND_CACHE_KEY]).catch(() => null)
        if (cached?.result) {
            return json({ ...JSON.parse(cached.result), cached: true })
        }

        const heatmap = await computeHeatmap(supabaseAdmin)
        await redisCommand(['SET', DEMAND_CACHE_KEY, JSON.stringify(heatmap), 'EX', String(CACHE_TTL_SECONDS)]).catch(() => null)
        return json({ ...heatmap, cached: false })
    } catch (e) {
        console.error('[driver_heatmap]', e)
        return json({ error: e instanceof Error ? e.message : 'Internal error' }, 500)
    }
})
