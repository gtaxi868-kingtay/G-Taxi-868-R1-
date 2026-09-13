import { requireCommander } from '../_shared/auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface HealthScore {
  overall: number
  breakdown: {
    rider_growth: { score: number; max: number; detail: string }
    merchant_growth: { score: number; max: number; detail: string }
    ride_volume: { score: number; max: number; detail: string }
    wait_time: { score: number; max: number; detail: string }
    driver_util: { score: number; max: number; detail: string }
    puck_coverage: { score: number; max: number; detail: string }
    retention: { score: number; max: number; detail: string }
  }
  rating: 'green' | 'yellow' | 'orange' | 'red'
  metrics: Record<string, unknown>
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { supabaseAdmin, commander } = await requireCommander(req)
    const territoryId = commander.territory_id

    if (!territoryId) {
      return new Response(
        JSON.stringify({ success: false, error: 'No territory assigned' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: territory } = await supabaseAdmin
      .from('territories')
      .select('name, created_at')
      .eq('id', territoryId)
      .single()

    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

    // ─── RIDE VOLUME (last 7 days) ───
    const { count: rides7d } = await supabaseAdmin
      .from('rides')
      .select('*', { count: 'exact', head: true })
      .eq('territory_id', territoryId)
      .gte('created_at', sevenDaysAgo.toISOString())

    const { count: completed7d } = await supabaseAdmin
      .from('rides')
      .select('*', { count: 'exact', head: true })
      .eq('territory_id', territoryId)
      .eq('status', 'completed')
      .gte('created_at', sevenDaysAgo.toISOString())

    // ─── RIDE VOLUME (previous 7 days, for growth) ───
    const { count: ridesPrev7d } = await supabaseAdmin
      .from('rides')
      .select('*', { count: 'exact', head: true })
      .eq('territory_id', territoryId)
      .gte('created_at', fourteenDaysAgo.toISOString())
      .lt('created_at', sevenDaysAgo.toISOString())

    // ─── UNIQUE RIDERS ───
    const { data: riderIds7d } = await supabaseAdmin
      .from('rides')
      .select('rider_id')
      .eq('territory_id', territoryId)
      .gte('created_at', sevenDaysAgo.toISOString())
      .not('rider_id', 'is', null)

    const { data: riderIdsPrev7d } = await supabaseAdmin
      .from('rides')
      .select('rider_id')
      .eq('territory_id', territoryId)
      .gte('created_at', fourteenDaysAgo.toISOString())
      .lt('created_at', sevenDaysAgo.toISOString())
      .not('rider_id', 'is', null)

    const uniqueRiders7d = new Set((riderIds7d || []).map(r => r.rider_id))
    const uniqueRidersPrev7d = new Set((riderIdsPrev7d || []).map(r => r.rider_id))
    const returningRiders7d = [...uniqueRiders7d].filter(r => uniqueRidersPrev7d.has(r)).length
    const totalRiders7d = uniqueRiders7d.size
    const ridersPrevCount = uniqueRidersPrev7d.size

    // ─── DRIVERS ───
    const { count: totalDrivers } = await supabaseAdmin
      .from('drivers')
      .select('*', { count: 'exact', head: true })
      .eq('territory_id', territoryId)

    const { count: onlineDrivers } = await supabaseAdmin
      .from('drivers')
      .select('*', { count: 'exact', head: true })
      .eq('territory_id', territoryId)
      .eq('is_online', true)

    // ─── DRIVER UTILIZATION: how many online drivers are actively on a ride ───
    const { data: activeDriverIds } = await supabaseAdmin
      .from('rides')
      .select('driver_id')
      .eq('territory_id', territoryId)
      .in('status', ['in_progress', 'arrived'])
      .not('driver_id', 'is', null)

    const uniqueActiveDrivers = new Set((activeDriverIds || []).map(r => r.driver_id)).size
    const driverUtilization = (onlineDrivers ?? 0) > 0 ? uniqueActiveDrivers / (onlineDrivers as number) : 0

    // ─── WAIT TIME ───
    const { data: waitTimes } = await supabaseAdmin
      .from('rides')
      .select('wait_time_seconds')
      .eq('territory_id', territoryId)
      .eq('status', 'completed')
      .not('wait_time_seconds', 'is', null)
      .gte('created_at', sevenDaysAgo.toISOString())

    const avgWaitSeconds = waitTimes && waitTimes.length > 0
      ? waitTimes.reduce((sum, r) => sum + (r.wait_time_seconds || 0), 0) / waitTimes.length
      : null

    // ─── MERCHANTS ───
    const { count: totalMerchants } = await supabaseAdmin
      .from('merchants')
      .select('*', { count: 'exact', head: true })
      .eq('territory_id', territoryId)

    const { count: activeMerchants } = await supabaseAdmin
      .from('merchants')
      .select('*', { count: 'exact', head: true })
      .eq('territory_id', territoryId)
      .eq('is_active', true)

    // ─── PUCKS ───
    const { count: totalPucks } = await supabaseAdmin
      .from('kiosk_nodes')
      .select('*', { count: 'exact', head: true })
      .eq('territory_id', territoryId)

    const { count: livePucks } = await supabaseAdmin
      .from('kiosk_nodes')
      .select('*', { count: 'exact', head: true })
      .eq('territory_id', territoryId)
      .eq('lifecycle_status', 'live')

    // ─── SCORING ───
    const TARGET_RIDES_PER_WEEK = Math.max(50, (totalDrivers || 1) * 10)
    const TARGET_PUCKS = Math.max(3, Math.ceil((totalMerchants || 1) * 1.5))

    const riderGrowth = ridersPrevCount > 0
      ? Math.min((totalRiders7d - ridersPrevCount) / ridersPrevCount, 0.2)
      : 0
    const riderGrowthScore = Math.round(riderGrowth * 100)

    const merchantGrowth = ridersPrevCount > 0
      ? Math.min((activeMerchants || 0) / Math.max(ridersPrevCount, 1) * 100, 15)
      : 0
    const merchantGrowthScore = Math.round(merchantGrowth)

    const rideVolumeScore = Math.round(Math.min((rides7d || 0) / TARGET_RIDES_PER_WEEK, 1) * 20)
    const waitTimeScore = avgWaitSeconds !== null
      ? Math.round(Math.max(0, 1 - avgWaitSeconds / 900) * 15)
      : 10
    const driverUtilScore = driverUtilization >= 0.6 && driverUtilization <= 0.85
      ? 10
      : Math.round(Math.max(0, 10 - Math.abs(0.7 - driverUtilization) * 30))
    const puckCoverageScore = Math.round(Math.min((livePucks || 0) / TARGET_PUCKS, 1) * 10)
    const retentionScore = totalRiders7d > 0
      ? Math.round((returningRiders7d / totalRiders7d) * 10)
      : 0

    const overall = Math.min(
      riderGrowthScore + merchantGrowthScore + rideVolumeScore +
      waitTimeScore + driverUtilScore + puckCoverageScore + retentionScore,
      100,
    )

    const rating = overall >= 80 ? 'green' : overall >= 60 ? 'yellow' : overall >= 40 ? 'orange' : 'red'

    const result: HealthScore = {
      overall,
      breakdown: {
        rider_growth: { score: riderGrowthScore, max: 20, detail: `${totalRiders7d} riders now, ${ridersPrevCount} prev 7d` },
        merchant_growth: { score: merchantGrowthScore, max: 15, detail: `${activeMerchants} active merchants` },
        ride_volume: { score: rideVolumeScore, max: 20, detail: `${rides7d} rides / ${TARGET_RIDES_PER_WEEK} target` },
        wait_time: { score: waitTimeScore, max: 15, detail: avgWaitSeconds !== null ? `${Math.round(avgWaitSeconds)}s avg wait` : 'No wait data' },
        driver_util: { score: driverUtilScore, max: 10, detail: `${Math.round(driverUtilization * 100)}% utilization` },
        puck_coverage: { score: puckCoverageScore, max: 10, detail: `${livePucks} live / ${TARGET_PUCKS} target` },
        retention: { score: retentionScore, max: 10, detail: `${returningRiders7d}/${totalRiders7d} returning riders` },
      },
      rating,
      metrics: {
        territory: territory?.name || 'Unknown',
        rides_7d: rides7d,
        completed_7d: completed7d,
        riders_7d: totalRiders7d,
        returning_riders_7d: returningRiders7d,
        drivers: { total: totalDrivers, online: onlineDrivers, active: uniqueActiveDrivers },
        utilization: Math.round(driverUtilization * 100),
        avg_wait_seconds: avgWaitSeconds ? Math.round(avgWaitSeconds) : null,
        merchants: { total: totalMerchants, active: activeMerchants },
        pucks: { total: totalPucks, live: livePucks },
        target_rides_per_week: TARGET_RIDES_PER_WEEK,
        target_pucks: TARGET_PUCKS,
      },
    }

    return new Response(
      JSON.stringify({ success: true, health: result }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('get_territory_health error:', err)
    if (err instanceof Response) return err
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
