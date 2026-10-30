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
// that gap — the request form only offers vehicle_classes rows that are
// is_leasable AND have a real, admin-entered financing_rate_pct
// (2026-09-02: real EV tiers were seeded with real CIF costs but no
// financing rate yet, since no lender quote exists — see
// compute_vehicle_class_lease_cents). Never gated on is_active: that
// column controls whether a class shows up as a bookable RIDE type to
// riders on this same shared table (RLS there is literally `is_active =
// true`), a completely different concern from G Garage offerability.

import { requireDriver } from '../_shared/auth.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { captureException } from '../_shared/sentry.ts'


import { getCorsHeaders } from '../_shared/cors.ts'

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
  const corsHeaders = getCorsHeaders(req);
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

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

        // is_leasable + financing_rate_pct IS NOT NULL — deliberately NOT
        // is_active, which instead gates whether a class shows up as a
        // bookable RIDE type to riders (vehicle_classes is shared with
        // ride-fare matching; RLS on it is literally `is_active = true`,
        // so an EV lease class must never flip is_active on or it leaks
        // into the rider app's fare picker). A class with no
        // financing_rate_pct yet is real cost data with no sourced
        // financing rate — never offered until an admin enters one.
        const { data: vehicleClassRows } = await supabaseAdmin
          .from('vehicle_classes')
          .select('key, label, description, category, landed_cost_cents, financing_rate_pct, financing_term_months, platform_margin_cents_per_day')
          .eq('is_leasable', true)
          .not('financing_rate_pct', 'is', null)
          .order('sort_order')

        const vehicleClasses = await Promise.all(
          (vehicleClassRows || []).map(async (vc) => {
            const { data: leaseCentsPerDay, error: leasePricingError } = await supabaseAdmin.rpc('compute_vehicle_class_lease_cents', { p_key: vc.key })
            if (leasePricingError) {
              console.error(`[g_garage:get_status] Lease pricing failed for ${vc.key}:`, leasePricingError)
              return { ...vc, lease_cents_per_day: null, lease_pricing_error: leasePricingError.message }
            }
            return { ...vc, lease_cents_per_day: leaseCentsPerDay }
          })
        )

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

        // Same gate as get_status: is_leasable + a real financing rate,
        // never is_active (that column controls ride-fare-picker
        // visibility on this shared table, not G Garage offerability).
        const { data: vClass } = await supabaseAdmin
          .from('vehicle_classes')
          .select('key, is_leasable, financing_rate_pct')
          .eq('key', vehicle_class_key)
          .maybeSingle()
        if (!vClass || !vClass.is_leasable || vClass.financing_rate_pct == null) {
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

      // ── Earn-to-Deposit: an ICE driver saves toward an EV deposit from
      // real ride earnings. Withholding happens automatically inside
      // process_wallet_payment_hardened / process_driver_settlement_atomic
      // once opted in — see credit_driver_payout and
      // 20260902010000_earn_to_deposit_phase_c.sql. Only wallet and card
      // ride payouts are covered; cash rides never produce a driver_payout
      // wallet credit to intercept (the driver already holds the cash).
      case 'opt_in_deposit_savings': {
        const { target_vehicle_class_key, withhold_percentage } = body
        if (!target_vehicle_class_key || typeof withhold_percentage !== 'number') {
          return json({ success: false, error: 'target_vehicle_class_key and withhold_percentage are required' }, 400)
        }
        if (!Number.isFinite(withhold_percentage) || withhold_percentage < 0 || withhold_percentage > 100) {
          return json({ success: false, error: 'withhold_percentage must be between 0 and 100' }, 400)
        }
        const { data, error } = await supabaseAdmin.rpc('opt_in_deposit_savings', {
          p_driver_user_id: driver.user_id,
          p_target_vehicle_class_key: target_vehicle_class_key,
          p_withhold_percentage: withhold_percentage,
        })
        if (error) {
          console.error('[g_garage:opt_in_deposit_savings] RPC failed:', error)
          return json({ success: false, error: 'Could not opt in' }, 500)
        }
        return json(data)
      }

      case 'request_deposit_refund': {
        const { reason } = body
        const { data, error } = await supabaseAdmin.rpc('request_deposit_refund', {
          p_driver_user_id: driver.user_id,
          p_reason: reason ?? null,
        })
        if (error) {
          console.error('[g_garage:request_deposit_refund] RPC failed:', error)
          return json({ success: false, error: 'Refund request failed' }, 500)
        }
        return json(data)
      }

      case 'get_deposit_savings_status': {
        const { data, error } = await supabaseAdmin
          .from('driver_deposit_savings')
          .select('*')
          .eq('driver_user_id', driver.user_id)
          .order('started_at', { ascending: false })
        if (error) throw error
        return json({ success: true, savings: data || [] })
      }

      // ── G-Partners: car wash / auto repair / insurance / fuel discounts.
      // A driver visits a partner in person and pays a discounted price
      // directly to them — no money moves through the platform here. See
      // 20260902030000_g_partners_phase_e.sql for the full design and why
      // it's a standalone catalog rather than reusing `merchants`.
      case 'list_partners': {
        const { data: partners, error: partnersError } = await supabaseAdmin
          .from('service_partners')
          .select('id, name, category, phone, whatsapp, territory_id')
          .eq('is_active', true)
          .order('name')
        if (partnersError) throw partnersError

        const { data: services, error: servicesError } = await supabaseAdmin
          .from('partner_services')
          .select('id, partner_id, name, price_cents, driver_discount_pct')
          .eq('is_active', true)
          .order('name')
        if (servicesError) throw servicesError

        const servicesByPartner: Record<string, any[]> = {}
        for (const s of services || []) {
          if (!servicesByPartner[s.partner_id]) servicesByPartner[s.partner_id] = []
          servicesByPartner[s.partner_id].push(s)
        }

        return json({
          success: true,
          partners: (partners || []).map((p: any) => ({ ...p, services: servicesByPartner[p.id] || [] })),
        })
      }

      case 'claim_partner_service': {
        const { partner_service_id } = body
        if (!partner_service_id) {
          return json({ success: false, error: 'partner_service_id is required' }, 400)
        }
        const { data, error } = await supabaseAdmin.rpc('claim_partner_service', {
          p_driver_user_id: driver.user_id,
          p_partner_service_id: partner_service_id,
        })
        if (error) {
          console.error('[g_garage:claim_partner_service] RPC failed:', error)
          return json({ success: false, error: error.message || 'Could not claim this service' }, 400)
        }
        return json({ success: true, claim: data })
      }

      case 'get_partner_usage_history': {
        const { data, error } = await supabaseAdmin
          .from('driver_partner_usage')
          .select('*, service_partners(name, category), partner_services(name)')
          .eq('driver_user_id', driver.user_id)
          .order('claimed_at', { ascending: false })
        if (error) throw error
        return json({ success: true, usage: data || [] })
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
