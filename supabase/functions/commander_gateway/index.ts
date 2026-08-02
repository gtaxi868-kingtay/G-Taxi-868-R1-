import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const VALID_LIFECYCLE_STATUSES = ['manufactured', 'assigned', 'activated', 'live', 'suspended', 'replaced'];
const COMMANDER_ALLOWED_TRANSITIONS: Record<string, string[]> = {
  assigned: ['activated'],
  activated: ['live', 'suspended'],
  live: ['suspended', 'replaced'],
  suspended: ['live', 'replaced'],
};

const VALID_RANKS = ['senior_driver', 'commander_candidate'] as const;
const MIN_RIDES: Record<string, number> = { senior_driver: 100, commander_candidate: 500 };
const MIN_RATING: Record<string, number> = { senior_driver: 4.5, commander_candidate: 4.6 };
const MIN_ACCEPTANCE: Record<string, number> = { senior_driver: 0.75, commander_candidate: 0.80 };
const MIN_TENURE_DAYS: Record<string, number> = { senior_driver: 0, commander_candidate: 90 };

function computePromotionScore(ridesCompleted: number, rating: number | null, acceptanceRate: number | null, tenureDays: number): number {
  const rideScore = Math.min(Math.log2(ridesCompleted + 1) / Math.log2(1001), 1) * 40;
  const ratingScore = (rating ?? 0) / 5 * 30;
  const acceptanceScore = Math.min(acceptanceRate ?? 0, 1) * 20;
  const tenureScore = Math.min(tenureDays / 365, 1) * 10;
  return Math.round(rideScore + ratingScore + acceptanceScore + tenureScore);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let actionForLog = '?';

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ success: false, error: 'Missing authorization header' }, 401);

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    );
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) return json({ success: false, error: 'Invalid or expired token' }, 401);

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles').select('role').eq('id', user.id).single();
    if (profileError || profile?.role !== 'pod_commander') {
      return json({ success: false, error: 'Forbidden: commander role required' }, 403);
    }

    const { data: commander, error: commanderError } = await supabaseAdmin
      .from('pod_commanders')
      .select('id, user_id, territory_id, status, onboarding_code, metrics')
      .eq('user_id', user.id).single();
    if (commanderError || !commander) return json({ success: false, error: 'Commander record not found' }, 403);
    if (commander.status !== 'active') return json({ success: false, error: 'Commander account is not active' }, 403);

    const body = await req.json().catch(() => ({}));
    const { action } = body;
    actionForLog = action || '?';

    switch (action) {

      // ── get_territory (was commander_get_territory) ──────────────────────
      case 'get_territory': {
        if (!commander.territory_id) return json({ success: false, error: 'No territory assigned' }, 400);

        const { data: territory, error: terrError } = await supabaseAdmin
          .from('territories').select('*').eq('id', commander.territory_id).single();
        if (terrError) throw terrError;

        const { data: pucks, error: puckError } = await supabaseAdmin
          .from('kiosk_nodes')
          .select('id, location_name, lifecycle_status, battery_level, last_heartbeat, is_active')
          .eq('territory_id', commander.territory_id);
        if (puckError) throw puckError;

        const { data: drivers, error: driverError } = await supabaseAdmin
          .from('drivers')
          .select('id, user_id, name, status, is_online, verified_status')
          .eq('territory_id', commander.territory_id);
        if (driverError) throw driverError;

        const activePucks = pucks.filter((p: any) => p.lifecycle_status === 'live' || p.lifecycle_status === 'activated');
        const activeDrivers = drivers.filter((d: any) => d.is_online && d.status === 'online');

        return json({
          success: true, territory, commander,
          metrics: {
            total_pucks: pucks.length, active_pucks: activePucks.length,
            total_drivers: drivers.length, active_drivers: activeDrivers.length,
          },
          pucks, drivers,
        });
      }

      // ── get_pucks (was commander_get_pucks) ───────────────────────────────
      case 'get_pucks': {
        let query = supabaseAdmin.from('kiosk_nodes').select('*, merchant:merchant_id(id, name, category)');
        if (commander.territory_id) query = query.eq('territory_id', commander.territory_id);
        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        return json({ success: true, nodes: data });
      }

      // ── update_puck_status (was commander_update_puck_status) ────────────
      case 'update_puck_status': {
        const { node_id, lifecycle_status, firmware_version, battery_level } = body;
        if (!node_id) return json({ success: false, error: 'node_id required' }, 400);

        const { data: existing, error: fetchError } = await supabaseAdmin
          .from('kiosk_nodes').select('id, lifecycle_status, territory_id').eq('id', node_id).single();
        if (fetchError || !existing) return json({ success: false, error: 'Node not found' }, 404);

        if (commander.territory_id && existing.territory_id !== commander.territory_id) {
          return json({ success: false, error: 'Node not in your territory' }, 403);
        }

        const updateData: Record<string, unknown> = {};

        if (lifecycle_status) {
          if (!VALID_LIFECYCLE_STATUSES.includes(lifecycle_status)) {
            return json({ success: false, error: 'Invalid lifecycle_status' }, 400);
          }
          const allowed = COMMANDER_ALLOWED_TRANSITIONS[existing.lifecycle_status];
          if (allowed && !allowed.includes(lifecycle_status)) {
            return json({ success: false, error: `Cannot transition from ${existing.lifecycle_status} to ${lifecycle_status}` }, 400);
          }
          updateData.lifecycle_status = lifecycle_status;
          if (lifecycle_status === 'activated' || lifecycle_status === 'live') {
            updateData.commissioned_at = new Date().toISOString();
            updateData.is_active = true;
          }
          if (lifecycle_status === 'replaced') {
            updateData.decommissioned_at = new Date().toISOString();
            updateData.is_active = false;
          }
          if (lifecycle_status === 'suspended') updateData.is_active = false;

          await supabaseAdmin.from('puck_events').insert({
            kiosk_node_id: node_id, event_type: 'status_change',
            metadata: { from: existing.lifecycle_status, to: lifecycle_status, changed_by: commander.user_id },
          }).maybeSingle();
        }

        if (firmware_version !== undefined) updateData.firmware_version = firmware_version;
        if (battery_level !== undefined) {
          updateData.battery_level = battery_level;
          updateData.last_heartbeat = new Date().toISOString();
        }

        const { data, error } = await supabaseAdmin
          .from('kiosk_nodes').update(updateData).eq('id', node_id).select().single();
        if (error) throw error;

        return json({ success: true, node: data });
      }

      // ── onboard_driver (was commander_onboard_driver) ─────────────────────
      case 'onboard_driver': {
        const { driver_id, sub_action } = body;
        if (!driver_id || !sub_action) return json({ success: false, error: 'driver_id and sub_action required' }, 400);
        if (!['approve', 'reject'].includes(sub_action)) {
          return json({ success: false, error: 'sub_action must be approve or reject' }, 400);
        }

        const { data: driver, error: driverError } = await supabaseAdmin
          .from('drivers').select('id, user_id, territory_id, status, verified_status, name').eq('id', driver_id).single();
        if (driverError || !driver) return json({ success: false, error: 'Driver not found' }, 404);

        if (commander.territory_id && driver.territory_id !== commander.territory_id) {
          return json({ success: false, error: 'Driver not in your territory' }, 403);
        }

        if (sub_action === 'approve') {
          const { error: updateError } = await supabaseAdmin
            .from('drivers').update({ status: 'online', verified_status: 'approved', is_verified: true }).eq('id', driver_id);
          if (updateError) throw updateError;

          const metrics = commander.metrics as Record<string, number>;
          await supabaseAdmin.from('pod_commanders')
            .update({ metrics: { ...metrics, drivers_onboarded: (metrics.drivers_onboarded || 0) + 1 } })
            .eq('id', commander.id);

          await supabaseAdmin.rpc('send_push_notification', {
            p_user_id: driver.user_id, p_title: 'Welcome to G-Taxi!',
            p_body: 'Your driver application has been approved by your territory commander.',
          }).maybeSingle();
        }

        const { data: updatedDriver } = await supabaseAdmin.from('drivers').select('*').eq('id', driver_id).single();
        return json({ success: true, driver: updatedDriver });
      }

      // ── onboard_merchant (was commander_onboard_merchant) ─────────────────
      case 'onboard_merchant': {
        const { merchant_id, sub_action } = body;
        if (!merchant_id || !sub_action) return json({ success: false, error: 'merchant_id and sub_action required' }, 400);
        if (!['invite', 'activate'].includes(sub_action)) {
          return json({ success: false, error: 'sub_action must be invite or activate' }, 400);
        }

        const { data: merchant, error: merchError } = await supabaseAdmin
          .from('merchants').select('id, name, territory_id, activation_status').eq('id', merchant_id).single();
        if (merchError || !merchant) return json({ success: false, error: 'Merchant not found' }, 404);

        if (commander.territory_id && merchant.territory_id !== commander.territory_id) {
          return json({ success: false, error: 'Merchant not in your territory' }, 403);
        }

        if (sub_action === 'activate') {
          const { error: updateError } = await supabaseAdmin
            .from('merchants').update({ activation_status: 'active', is_active: true }).eq('id', merchant_id);
          if (updateError) throw updateError;

          const metrics = commander.metrics as Record<string, number>;
          await supabaseAdmin.from('pod_commanders')
            .update({ metrics: { ...metrics, merchants_onboarded: (metrics.merchants_onboarded || 0) + 1 } })
            .eq('id', commander.id);
        }

        return json({ success: true, merchant_id });
      }

      // ── get_driver_queue (was commander_get_driver_queue) ─────────────────
      case 'get_driver_queue': {
        let query = supabaseAdmin
          .from('drivers')
          .select('*, profile:user_id(id, full_name, email, phone_number, created_at)')
          .in('verified_status', ['unverified', 'pending'])
          .in('status', ['offline', 'pending']);
        if (commander.territory_id) query = query.eq('territory_id', commander.territory_id);
        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        return json({ success: true, pending_drivers: data, count: data.length });
      }

      // ── successor_list / set / confirm / remove (was commander_set_successor) ──
      case 'successor_list': {
        if (!commander.territory_id) return json({ success: false, error: 'No territory assigned' }, 400);
        const { data, error } = await supabaseAdmin
          .from('territory_successors')
          .select('*, successor:successor_id(id, email, full_name)')
          .eq('territory_id', commander.territory_id).eq('is_active', true)
          .order('priority', { ascending: true });
        if (error) throw error;
        return json({ success: true, successors: data });
      }

      case 'successor_set': {
        if (!commander.territory_id) return json({ success: false, error: 'No territory assigned' }, 400);
        const { successor_id, priority, notes } = body;
        if (!successor_id || !priority) return json({ success: false, error: 'successor_id and priority required' }, 400);
        if (priority < 1 || priority > 3) return json({ success: false, error: 'priority must be 1, 2, or 3' }, 400);
        if (successor_id === commander.user_id) return json({ success: false, error: 'Cannot set yourself as successor' }, 400);

        const { data: successorProfile, error: profileErr2 } = await supabaseAdmin
          .from('profiles').select('id, role, email, full_name').eq('id', successor_id).single();
        if (profileErr2 || !successorProfile) return json({ success: false, error: 'Successor profile not found' }, 404);
        if (successorProfile.role === 'pod_commander') return json({ success: false, error: 'Successor is already a commander' }, 400);

        const { data: successorDriver } = await supabaseAdmin
          .from('drivers').select('id, territory_id, rank').eq('user_id', successor_id).maybeSingle();

        const { data, error } = await supabaseAdmin
          .from('territory_successors')
          .upsert({
            territory_id: commander.territory_id, successor_id,
            successor_driver_id: successorDriver?.id || null, priority,
            status: 'pending', notes: notes || null, is_active: true,
          }, { onConflict: 'territory_id, priority', ignoreDuplicates: false })
          .select('*, successor:successor_id(id, email, full_name)').single();
        if (error) throw error;

        return json({ success: true, successor: data });
      }

      case 'successor_confirm': {
        if (!commander.territory_id) return json({ success: false, error: 'No territory assigned' }, 400);
        const { successor_id } = body;
        if (!successor_id) return json({ success: false, error: 'successor_id required' }, 400);

        const { data, error } = await supabaseAdmin
          .from('territory_successors')
          .update({ status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: commander.user_id })
          .eq('territory_id', commander.territory_id).eq('successor_id', successor_id)
          .select('*, successor:successor_id(id, email, full_name)').single();
        if (error) throw error;

        return json({ success: true, successor: data });
      }

      case 'successor_remove': {
        if (!commander.territory_id) return json({ success: false, error: 'No territory assigned' }, 400);
        const { successor_id } = body;
        if (!successor_id) return json({ success: false, error: 'successor_id required' }, 400);

        const { error } = await supabaseAdmin
          .from('territory_successors')
          .update({ is_active: false, status: 'declined' })
          .eq('territory_id', commander.territory_id).eq('successor_id', successor_id);
        if (error) throw error;

        return json({ success: true });
      }

      // ── handoff (was commander_handoff) ────────────────────────────────────
      case 'handoff': {
        const { to_user_id, reason } = body;
        if (!to_user_id) return json({ success: false, error: 'to_user_id required' }, 400);
        if (to_user_id === commander.user_id) return json({ success: false, error: 'Cannot hand off to yourself' }, 400);

        const territoryId = commander.territory_id;
        if (!territoryId) return json({ success: false, error: 'No territory assigned' }, 400);

        const { data: successorProfile, error: profileErr3 } = await supabaseAdmin
          .from('profiles').select('id, role, full_name').eq('id', to_user_id).single();
        if (profileErr3 || !successorProfile) return json({ success: false, error: 'Successor profile not found' }, 404);

        const { data: territory, error: terrError2 } = await supabaseAdmin
          .from('territories').select('name').eq('id', territoryId).single();
        if (terrError2) throw terrError2;

        const { data: existingCommander } = await supabaseAdmin
          .from('pod_commanders').select('id, territory_id').eq('user_id', to_user_id).maybeSingle();
        if (existingCommander) return json({ success: false, error: 'Target user is already a commander' }, 400);

        const { data: successorDriver } = await supabaseAdmin
          .from('drivers').select('id').eq('user_id', to_user_id).maybeSingle();

        await supabaseAdmin.from('promotion_log').insert({
          driver_id: successorDriver?.id || null, to_rank: 'commander_candidate',
          authorized_by: commander.user_id, reason: 'Commander handoff: ' + (reason || 'voluntary transfer'),
          metadata: { handoff: true, from_commander: commander.user_id, territory_id: territoryId },
        }).maybeSingle();

        const { data: newCommander, error: insertError } = await supabaseAdmin
          .from('pod_commanders')
          .insert({ user_id: to_user_id, territory_id: territoryId, status: 'active', metrics: commander.metrics || {} })
          .select().single();
        if (insertError) throw insertError;

        await supabaseAdmin.from('territories').update({ commander_id: to_user_id }).eq('id', territoryId);
        await supabaseAdmin.from('profiles').update({ role: 'pod_commander' }).eq('id', to_user_id);
        await supabaseAdmin.from('profiles').update({ role: 'driver' }).eq('id', commander.user_id);
        await supabaseAdmin.from('pod_commanders').delete().eq('id', commander.id);

        await supabaseAdmin.from('system_alerts').insert({
          type: 'commander_handoff', severity: 'info',
          title: 'Commander handoff: ' + (territory?.name || 'unknown'),
          details: { from: commander.user_id, to: to_user_id, reason: reason || 'voluntary', territory_id: territoryId },
        }).maybeSingle();

        return json({ success: true, message: 'Territory transferred successfully', new_commander: newCommander });
      }

      // ── promote_driver (was commander_promote_driver) ─────────────────────
      case 'promote_driver': {
        const { driver_id, target_rank, reason } = body;
        if (!driver_id || !target_rank) return json({ success: false, error: 'driver_id and target_rank required' }, 400);
        if (!VALID_RANKS.includes(target_rank)) {
          return json({ success: false, error: `Invalid target_rank. Must be: ${VALID_RANKS.join(', ')}` }, 400);
        }

        const { data: driver, error: driverError2 } = await supabaseAdmin
          .from('drivers')
          .select('id, user_id, name, rank, territory_id, rating, rating_count, acceptance_rate, territory_joined_at')
          .eq('id', driver_id).single();
        if (driverError2 || !driver) return json({ success: false, error: 'Driver not found' }, 404);

        if (commander.territory_id && driver.territory_id !== commander.territory_id) {
          return json({ success: false, error: 'Driver not in your territory' }, 403);
        }

        const requiredCurrentRank = target_rank === 'senior_driver' ? 'driver' : 'senior_driver';
        if (driver.rank !== requiredCurrentRank) {
          return json({
            success: false,
            error: `Driver must be rank '${requiredCurrentRank}' to promote to '${target_rank}'. Current rank: ${driver.rank}`,
          }, 400);
        }

        const { count: ridesCompleted } = await supabaseAdmin
          .from('rides').select('*', { count: 'exact', head: true }).eq('driver_id', driver.user_id).eq('status', 'completed');

        const completedCount = ridesCompleted || 0;
        const minRides = MIN_RIDES[target_rank];
        if (completedCount < minRides) {
          return json({ success: false, error: `Driver needs ${minRides} completed rides for ${target_rank}. Has: ${completedCount}` }, 400);
        }

        const rating = driver.rating || 0;
        const minRating = MIN_RATING[target_rank];
        if (rating < minRating) {
          return json({ success: false, error: `Driver needs rating ${minRating} for ${target_rank}. Rating: ${rating}` }, 400);
        }

        const acceptanceRate = driver.acceptance_rate || 0;
        const minAcceptance = MIN_ACCEPTANCE[target_rank];
        if (acceptanceRate < minAcceptance) {
          return json({ success: false, error: `Driver needs acceptance rate ${minAcceptance} for ${target_rank}. Rate: ${acceptanceRate}` }, 400);
        }

        const tenureDays = driver.territory_joined_at
          ? Math.floor((Date.now() - new Date(driver.territory_joined_at).getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        const minTenure = MIN_TENURE_DAYS[target_rank];
        if (tenureDays < minTenure) {
          return json({ success: false, error: `Driver needs ${minTenure} days in territory for ${target_rank}. Days: ${tenureDays}` }, 400);
        }

        const promotionScore = computePromotionScore(completedCount, rating, acceptanceRate, tenureDays);
        const fromRank = driver.rank;

        const { error: updateError2 } = await supabaseAdmin.from('drivers').update({ rank: target_rank }).eq('id', driver_id);
        if (updateError2) throw updateError2;

        const { error: logError } = await supabaseAdmin.from('promotion_log').insert({
          driver_id, from_rank: fromRank, to_rank: target_rank, authorized_by: commander.user_id,
          promotion_score: promotionScore, reason: reason || 'Promoted by territory commander',
          metadata: {
            territory_id: commander.territory_id, rides_completed: completedCount,
            rating, acceptance_rate: acceptanceRate, tenure_days: tenureDays,
          },
        });
        if (logError) throw logError;

        const commanderMetrics = (commander.metrics as Record<string, number>) || {};
        await supabaseAdmin.from('pod_commanders')
          .update({ metrics: { ...commanderMetrics, promotions_given: (commanderMetrics.promotions_given || 0) + 1 } })
          .eq('id', commander.id).maybeSingle();

        if (driver.user_id) {
          await supabaseAdmin.rpc('send_push_notification', {
            p_user_id: driver.user_id, p_title: 'Promotion!',
            p_body: `You've been promoted to ${target_rank.replace('_', ' ')}!`,
          }).maybeSingle();
        }

        const { data: updatedDriver } = await supabaseAdmin.from('drivers').select('*').eq('id', driver_id).single();
        return json({ success: true, driver: updatedDriver, promotion_score: promotionScore, previous_rank: fromRank });
      }

      default:
        return json({ success: false, error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error(`commander_gateway/${actionForLog} error:`, err);
    return json({ success: false, error: err.message || 'Internal error' }, 500);
  }
});
