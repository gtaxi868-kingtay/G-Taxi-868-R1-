// G Garage — driver-facing vehicle sourcing requests.
//
// A driver opts in to request a vehicle through the platform (local BYD
// dealer fallback, or a platform-facilitated import once one is legally
// confirmed — see /Users/kingtay/.claude/plans/b-optimized-phoenix.md).
// The platform never picks the number for them: min/max daily
// contribution bounds are computed here from the driver's OWN real
// completed-ride payout history, never from an invented flat rate.
//
// Tier (Entry / Proven / Elite) reuses drivers.rank directly — the same
// column commander_gateway/commander_promote_driver already promotes
// against — rather than recomputing a parallel score, so there is one
// source of truth for driver standing, not two that can drift.
//
// "Year 3+ Prestige" tier vehicles are intentionally not selectable here:
// the plan explicitly leaves that tier's real threshold undecided, and no
// prestige vehicle_classes rows exist yet. Nothing is fabricated to fill
// that gap — the request form only offers vehicle_classes rows that
// actually exist and are is_active = true today.

import { requireDriver } from '../_shared/auth.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { captureException } from '../_shared/sentry.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const MIN_EARNING_DAYS_REQUIRED = 14
const MIN_CONTRIBUTION_PCT_OF_FLOOR = 0.20 // 20% of a driver's realistic floor day

function tierFromRank(rank: string | null): 'entry' | 'proven' | 'elite' {
  if (rank === 'commander_candidate') return 'elite'
  if (rank === 'senior_driver') return 'proven'
  return 'entry'
}

async function computeEligibility(supabaseAdmin: any, driverId: string) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: rides, error } = await supabaseAdmin
    .from('rides')
    .select('driver_payout_cents, completed_at')
    .eq('driver_id', driverId)
    .eq('status', 'completed')
    .gte('completed_at', since)
    .not('driver_payout_cents', 'is', null)

  if (error) throw error

  const byDay: Record<string, number> = {}
  for (const r of rides || []) {
    const day = (r.completed_at as string).slice(0, 10)
    byDay[day] = (byDay[day] || 0) + (r.driver_payout_cents || 0)
  }
  const dailyTotals = Object.values(byDay).sort((a, b) => a - b)

  if (dailyTotals.length < MIN_EARNING_DAYS_REQUIRED) {
    return {
      eligible: false,
      reason: 'insufficient_history',
      days_with_earnings: dailyTotals.length,
      days_required: MIN_EARNING_DAYS_REQUIRED,
    }
  }

  const floorIdx = Math.floor(dailyTotals.length * 0.25)
  const floorDailyCents = dailyTotals[floorIdx]
  const ceilingDailyCents = dailyTotals[dailyTotals.length - 1]
  const minDailyContributionCents = Math.max(0, Math.round(floorDailyCents * MIN_CONTRIBUTION_PCT_OF_FLOOR))
  const maxDailyContributionCents = Math.max(minDailyContributionCents, Math.round(ceilingDailyCents))

  return {
    eligible: true,
    days_with_earnings: dailyTotals.length,
    floor_daily_earnings_cents: floorDailyCents,
    ceiling_daily_earnings_cents: ceilingDailyCents,
    min_daily_contribution_cents: minDailyContributionCents,
    max_daily_contribution_cents: maxDailyContributionCents,
  }
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
    const body = await req.json().catch(() => ({}))
    const { action } = body

    switch (action) {
      case 'get_status': {
        const eligibility = await computeEligibility(supabaseAdmin, driver.id)

        const { data: driverRow } = await supabaseAdmin
          .from('drivers')
          .select('rank, registration_class')
          .eq('id', driver.id)
          .single()

        const { data: vehicleClasses } = await supabaseAdmin
          .from('vehicle_classes')
          .select('key, label, description, category, is_active')
          .eq('is_active', true)
          .order('sort_order')

        const { data: requests } = await supabaseAdmin
          .from('g_garage_requests')
          .select('*')
          .eq('driver_id', driver.id)
          .order('created_at', { ascending: false })

        return json({
          success: true,
          tier: tierFromRank(driverRow?.rank ?? null),
          registration_class: driverRow?.registration_class ?? 'unverified',
          eligibility,
          vehicle_classes: vehicleClasses || [],
          requests: requests || [],
        })
      }

      case 'submit_request': {
        const { vehicle_class_key, source, requested_daily_contribution_cents, h_registration_opt_in } = body

        if (!vehicle_class_key || !['local_dealer', 'platform_import'].includes(source)) {
          return json({ success: false, error: 'vehicle_class_key and source (local_dealer|platform_import) required' }, 400)
        }
        if (!Number.isInteger(requested_daily_contribution_cents) || requested_daily_contribution_cents < 0) {
          return json({ success: false, error: 'requested_daily_contribution_cents must be a non-negative integer' }, 400)
        }

        const { data: existingOpen } = await supabaseAdmin
          .from('g_garage_requests')
          .select('id')
          .eq('driver_id', driver.id)
          .in('status', ['pending', 'approved', 'active'])
          .maybeSingle()
        if (existingOpen) {
          return json({ success: false, error: 'You already have an open G Garage request or active lease.' }, 409)
        }

        const { data: vClass } = await supabaseAdmin
          .from('vehicle_classes')
          .select('key, is_active')
          .eq('key', vehicle_class_key)
          .maybeSingle()
        if (!vClass || !vClass.is_active) {
          return json({ success: false, error: 'That vehicle class is not currently available.' }, 400)
        }

        // Recompute eligibility server-side — never trust client-sent bounds.
        const eligibility = await computeEligibility(supabaseAdmin, driver.id)
        if (!eligibility.eligible) {
          return json({ success: false, error: 'Not yet eligible', eligibility }, 403)
        }
        if (
          requested_daily_contribution_cents < eligibility.min_daily_contribution_cents! ||
          requested_daily_contribution_cents > eligibility.max_daily_contribution_cents!
        ) {
          return json({
            success: false,
            error: `Requested amount must be between ${eligibility.min_daily_contribution_cents} and ${eligibility.max_daily_contribution_cents} cents/day, based on your real last-30-day earnings.`,
          }, 400)
        }

        const { data, error } = await supabaseAdmin
          .from('g_garage_requests')
          .insert({
            driver_id: driver.id,
            vehicle_class_key,
            source,
            min_daily_contribution_cents: eligibility.min_daily_contribution_cents,
            max_daily_contribution_cents: eligibility.max_daily_contribution_cents,
            requested_daily_contribution_cents,
            h_registration_opt_in: !!h_registration_opt_in,
          })
          .select()
          .single()
        if (error) throw error

        return json({ success: true, request: data })
      }

      default:
        return json({ success: false, error: `Unknown action: ${action}` }, 400)
    }
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('g_garage error:', err)
    await captureException(err, { function: 'g_garage' })
    return json({ success: false, error: err.message || 'Internal error' }, 500)
  }
})
