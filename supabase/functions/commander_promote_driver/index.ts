import { requireCommander } from './_shared/auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const VALID_RANKS = ['senior_driver', 'commander_candidate'] as const
const MIN_RIDES: Record<string, number> = {
  senior_driver: 100,
  commander_candidate: 500,
}
const MIN_RATING: Record<string, number> = {
  senior_driver: 4.5,
  commander_candidate: 4.6,
}
const MIN_ACCEPTANCE: Record<string, number> = {
  senior_driver: 0.75,
  commander_candidate: 0.80,
}
const MIN_TENURE_DAYS: Record<string, number> = {
  senior_driver: 0,
  commander_candidate: 90,
}

function computePromotionScore(
  ridesCompleted: number,
  rating: number | null,
  acceptanceRate: number | null,
  tenureDays: number,
): number {
  const rideScore = Math.min(Math.log2(ridesCompleted + 1) / Math.log2(1001), 1) * 40
  const ratingScore = (rating !== null && rating !== undefined ? Math.min(rating / 5, 1) : 0) * 30
  const acceptanceScore = (acceptanceRate !== null && acceptanceRate !== undefined ? Math.min(acceptanceRate, 1) : 0) * 20
  const tenureScore = Math.min(tenureDays / 365, 1) * 10
  return Math.round(rideScore + ratingScore + acceptanceScore + tenureScore)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { supabaseAdmin, commander } = await requireCommander(req)
    const { driver_id, target_rank, reason } = await req.json()

    if (!driver_id || !target_rank) {
      return new Response(
        JSON.stringify({ success: false, error: 'driver_id and target_rank required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!VALID_RANKS.includes(target_rank)) {
      return new Response(
        JSON.stringify({ success: false, error: `Invalid target_rank. Must be: ${VALID_RANKS.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: driver, error: driverError } = await supabaseAdmin
      .from('drivers')
      .select('id, user_id, name, rank, territory_id, rating, rating_count, acceptance_rate, territory_joined_at')
      .eq('id', driver_id)
      .single()

    if (driverError || !driver) {
      return new Response(
        JSON.stringify({ success: false, error: 'Driver not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (commander.territory_id && driver.territory_id !== commander.territory_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Driver not in your territory' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const requiredCurrentRank = target_rank === 'senior_driver' ? 'driver' : 'senior_driver'
    if (driver.rank !== requiredCurrentRank) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Driver must be rank '${requiredCurrentRank}' to promote to '${target_rank}'. Current rank: ${driver.rank}`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { count: ridesCompleted } = await supabaseAdmin
      .from('rides')
      .select('*', { count: 'exact', head: true })
      .eq('driver_id', driver.user_id)
      .eq('status', 'completed')

    const completedCount = ridesCompleted || 0
    const minRides = MIN_RIDES[target_rank]
    if (completedCount < minRides) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Driver needs ${minRides} completed rides for ${target_rank}. Has: ${completedCount}`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const rating = driver.rating || 0
    const minRating = MIN_RATING[target_rank]
    if (rating < minRating) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Driver needs rating ${minRating} for ${target_rank}. Rating: ${rating}`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const acceptanceRate = driver.acceptance_rate || 0
    const minAcceptance = MIN_ACCEPTANCE[target_rank]
    if (acceptanceRate < minAcceptance) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Driver needs acceptance rate ${minAcceptance} for ${target_rank}. Rate: ${acceptanceRate}`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const tenureDays = driver.territory_joined_at
      ? Math.floor((Date.now() - new Date(driver.territory_joined_at).getTime()) / (1000 * 60 * 60 * 24))
      : 0
    const minTenure = MIN_TENURE_DAYS[target_rank]
    if (tenureDays < minTenure) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Driver needs ${minTenure} days in territory for ${target_rank}. Days: ${tenureDays}`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const promotionScore = computePromotionScore(completedCount, rating, acceptanceRate, tenureDays)

    const fromRank = driver.rank

    const { error: updateError } = await supabaseAdmin
      .from('drivers')
      .update({ rank: target_rank })
      .eq('id', driver_id)

    if (updateError) throw updateError

    const { error: logError } = await supabaseAdmin
      .from('promotion_log')
      .insert({
        driver_id: driver_id,
        from_rank: fromRank,
        to_rank: target_rank,
        authorized_by: commander.user_id,
        promotion_score: promotionScore,
        reason: reason || `Promoted by territory commander`,
        metadata: {
          territory_id: commander.territory_id,
          rides_completed: completedCount,
          rating: rating,
          acceptance_rate: acceptanceRate,
          tenure_days: tenureDays,
        },
      })

    if (logError) throw logError

    const commanderMetrics = commander.metrics as Record<string, number> || {}
    await supabaseAdmin
      .from('pod_commanders')
      .update({
        metrics: {
          ...commanderMetrics,
          promotions_given: (commanderMetrics.promotions_given || 0) + 1,
        },
      })
      .eq('id', commander.id)
      .maybeSingle()

    if (driver.user_id) {
      await supabaseAdmin.rpc('send_push_notification', {
        p_user_id: driver.user_id,
        p_title: 'Promotion!',
        p_body: `You've been promoted to ${target_rank.replace('_', ' ')}!`,
      }).maybeSingle()
    }

    const { data: updatedDriver } = await supabaseAdmin
      .from('drivers')
      .select('*')
      .eq('id', driver_id)
      .single()

    return new Response(
      JSON.stringify({
        success: true,
        driver: updatedDriver,
        promotion_score: promotionScore,
        previous_rank: fromRank,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('commander_promote_driver error:', err)
    if (err instanceof Response) return err
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
