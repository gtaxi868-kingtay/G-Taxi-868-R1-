import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: territories, error: terrError } = await supabaseAdmin
      .from('territories')
      .select('id, name, created_at')
      .eq('is_active', true)

    if (terrError) throw terrError
    if (!territories || territories.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No active territories', snapshots_created: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const results: Array<{ territory_id: string; territory_name: string; snapshot_id: string }> = []

    for (const territory of territories) {
      const { count: totalDrivers } = await supabaseAdmin
        .from('drivers').select('*', { count: 'exact', head: true })
        .eq('territory_id', territory.id)

      const { count: activeDrivers } = await supabaseAdmin
        .from('drivers').select('*', { count: 'exact', head: true })
        .eq('territory_id', territory.id)
        .eq('is_online', true)

      const { count: totalMerchants } = await supabaseAdmin
        .from('merchants').select('*', { count: 'exact', head: true })
        .eq('territory_id', territory.id)

      const { count: activeMerchants } = await supabaseAdmin
        .from('merchants').select('*', { count: 'exact', head: true })
        .eq('territory_id', territory.id)
        .eq('is_active', true)

      const { count: totalPucks } = await supabaseAdmin
        .from('kiosk_nodes').select('*', { count: 'exact', head: true })
        .eq('territory_id', territory.id)

      const { count: livePucks } = await supabaseAdmin
        .from('kiosk_nodes').select('*', { count: 'exact', head: true })
        .eq('territory_id', territory.id)
        .eq('lifecycle_status', 'live')

      const { count: ridesLast7d } = await supabaseAdmin
        .from('rides').select('*', { count: 'exact', head: true })
        .eq('territory_id', territory.id)
        .gte('created_at', sevenDaysAgo.toISOString())

      const { count: completedLast7d } = await supabaseAdmin
        .from('rides').select('*', { count: 'exact', head: true })
        .eq('territory_id', territory.id)
        .eq('status', 'completed')
        .gte('created_at', sevenDaysAgo.toISOString())

      const { data: revenueData } = await supabaseAdmin
        .from('rides').select('total_fare_cents')
        .eq('territory_id', territory.id)
        .eq('status', 'completed')
        .gte('created_at', sevenDaysAgo.toISOString())

      const totalRevenue = (revenueData || []).reduce((sum, r) => sum + (r.total_fare_cents || 0), 0)

      const { data: waitData } = await supabaseAdmin
        .from('rides').select('wait_time_seconds')
        .eq('territory_id', territory.id)
        .eq('status', 'completed')
        .not('wait_time_seconds', 'is', null)
        .gte('created_at', sevenDaysAgo.toISOString())

      const avgWait = waitData && waitData.length > 0
        ? waitData.reduce((s, r) => s + (r.wait_time_seconds || 0), 0) / waitData.length
        : null

      const { data: riderIds } = await supabaseAdmin
        .from('rides').select('rider_id')
        .eq('territory_id', territory.id)
        .gte('created_at', sevenDaysAgo.toISOString())
        .not('rider_id', 'is', null)

      const uniqueRiders = new Set((riderIds || []).map(r => r.rider_id)).size

      const { data: ratingData } = await supabaseAdmin
        .from('rides').select('rating')
        .eq('territory_id', territory.id)
        .eq('status', 'completed')
        .not('rating', 'is', null)
        .gte('created_at', sevenDaysAgo.toISOString())

      const avgRating = ratingData && ratingData.length > 0
        ? ratingData.reduce((s, r) => s + (r.rating || 0), 0) / ratingData.length
        : null

      const cancelledCount = ridesLast7d && completedLast7d
        ? Math.max(0, ridesLast7d - completedLast7d)
        : 0
      const cancellationRate = ridesLast7d && ridesLast7d > 0
        ? cancelledCount / ridesLast7d
        : null

      const { data: activeRideDrivers } = await supabaseAdmin
        .from('rides').select('driver_id')
        .eq('territory_id', territory.id)
        .in('status', ['in_progress', 'arrived'])
        .not('driver_id', 'is', null)

      const activeOnRide = new Set((activeRideDrivers || []).map(r => r.driver_id)).size
      const driverUtil = activeDrivers > 0 ? activeOnRide / activeDrivers : null

      const { count: newDrivers7d } = await supabaseAdmin
        .from('drivers').select('*', { count: 'exact', head: true })
        .eq('territory_id', territory.id)
        .gte('created_at', sevenDaysAgo.toISOString())

      const { count: newMerchants7d } = await supabaseAdmin
        .from('merchants').select('*', { count: 'exact', head: true })
        .eq('territory_id', territory.id)
        .gte('created_at', sevenDaysAgo.toISOString())

      const { data: newRiderIds } = await supabaseAdmin
        .from('rides').select('rider_id')
        .eq('territory_id', territory.id)
        .gte('created_at', sevenDaysAgo.toISOString())
        .not('rider_id', 'is', null)

      const newRiders7d = new Set((newRiderIds || []).map(r => r.rider_id)).size

      const { data: snapshot, error: snapError } = await supabaseAdmin
        .from('territory_metrics_snapshot')
        .insert({
          territory_id: territory.id,
          total_drivers: totalDrivers || 0,
          active_drivers: activeDrivers || 0,
          online_drivers: activeDrivers || 0,
          pending_drivers: 0,
          total_merchants: totalMerchants || 0,
          active_merchants: activeMerchants || 0,
          total_pucks: totalPucks || 0,
          live_pucks: livePucks || 0,
          rides_last_7d: ridesLast7d || 0,
          completed_rides_last_7d: completedLast7d || 0,
          unique_riders_last_7d: uniqueRiders,
          total_revenue_cents: totalRevenue,
          avg_wait_time_seconds: avgWait,
          avg_ride_fare_cents: completedLast7d && completedLast7d > 0
            ? Math.round(totalRevenue / completedLast7d) : null,
          avg_rating: avgRating,
          cancellation_rate: cancellationRate,
          driver_utilization_pct: driverUtil,
          new_drivers_7d: newDrivers7d || 0,
          new_merchants_7d: newMerchants7d || 0,
          new_riders_7d: newRiders7d,
        })
        .select('id')
        .single()

      if (snapError) {
        console.error(`Failed to snapshot ${territory.name}:`, snapError)
        continue
      }

      results.push({
        territory_id: territory.id,
        territory_name: territory.name,
        snapshot_id: snapshot.id,
      })
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Snapshots created for ${results.length} territories`,
        snapshots_created: results.length,
        territories: results,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('refresh_territory_forecasts error:', err)
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
