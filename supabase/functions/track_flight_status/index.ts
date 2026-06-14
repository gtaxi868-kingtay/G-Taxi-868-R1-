import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Admin-only flight tracking webhook / manual trigger.
// Called by an airline integration, by admin dashboard, or by an operator
// who receives a text update from the airline desk.
//
// On ARRIVED: cascades through every confirmed reservation on this flight block —
//   aviation leg (leg 2) → completed
//   destination ground leg (leg 3) → driver_en_route
//   master_escape_itineraries.status → ON_ISLAND
//   package_reservations.status → ON_ISLAND
//   push notification → each rider + tobago driver
//
// On AIRBORNE: marks aviation leg in_transit, pushes riders a "You're in the air" message.
// On APPROACHING: no state change — just pushes an ETA update to riders.
// On DELAYED: marks aviation leg delayed, records estimated_arrival_override in metadata.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

type TrackingStatus = 'AIRBORNE' | 'APPROACHING' | 'ARRIVED' | 'DELAYED';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // Admin-only — verify JWT and check admin role
  const authHeader = req.headers.get('Authorization');
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader?.replace('Bearer ', '') ?? ''
  );
  if (authError || !user) return json({ error: 'Unauthorized' }, 401);

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') return json({ error: 'Admin only' }, 403);

  const {
    flight_block_id,
    tracking_status,
    estimated_arrival_override,
  }: {
    flight_block_id: string;
    tracking_status: TrackingStatus;
    estimated_arrival_override?: string;
  } = await req.json();

  if (!flight_block_id) return json({ error: 'flight_block_id required' }, 400);
  if (!['AIRBORNE', 'APPROACHING', 'ARRIVED', 'DELAYED'].includes(tracking_status)) {
    return json({ error: 'tracking_status must be AIRBORNE | APPROACHING | ARRIVED | DELAYED' }, 400);
  }

  // Fetch the flight block
  const { data: block, error: blockErr } = await supabase
    .from('flight_blocks')
    .select('id, destination_name, destination_code, departure_time, outbound_arrival_time')
    .eq('id', flight_block_id)
    .single();

  if (blockErr || !block) return json({ error: 'Flight block not found' }, 404);

  const arrivedAt = estimated_arrival_override ?? block.outbound_arrival_time ?? new Date().toISOString();

  // Fetch all CONFIRMED (or later-phase) reservations on this block
  const { data: reservations } = await supabase
    .from('package_reservations')
    .select(`
      id, rider_id, status,
      master_escape_itineraries ( id, status )
    `)
    .eq('flight_block_id', flight_block_id)
    .in('status', ['CONFIRMED', 'EN_ROUTE_DEPART', 'ON_ISLAND']);

  if (!reservations || reservations.length === 0) {
    return json({ message: 'No active reservations for this flight block', tracking_status });
  }

  // Fetch FCM/push tokens for riders
  const riderIds = reservations.map(r => r.rider_id);

  const { data: pushTokens } = await supabase
    .from('profiles')
    .select('id, push_token')
    .in('id', riderIds)
    .not('push_token', 'is', null);

  const tokenMap: Record<string, string> = {};
  for (const p of pushTokens ?? []) {
    if (p.push_token) tokenMap[p.id] = p.push_token;
  }

  const sendPush = async (riderId: string, title: string, body: string) => {
    const token = tokenMap[riderId];
    if (!token) return;
    try {
      await supabase.functions.invoke('send_push_notification', {
        body: { token, title, body },
      });
    } catch (e) {
      console.error('Push failed for rider', riderId, e);
    }
  };

  const results: Record<string, string> = {};

  if (tracking_status === 'AIRBORNE') {
    // Mark aviation leg (leg 2) as in_transit for each reservation
    for (const res of reservations) {
      const itin = Array.isArray(res.master_escape_itineraries)
        ? res.master_escape_itineraries[0]
        : res.master_escape_itineraries;
      if (!itin) continue;

      const { error } = await supabase
        .from('itinerary_legs')
        .update({ status: 'in_transit', actual_start: new Date().toISOString() })
        .eq('master_itinerary_id', itin.id)
        .eq('leg_sequence', 2)
        .eq('status', 'scheduled');

      if (!error) {
        await sendPush(
          res.rider_id,
          `You're in the air! ✈️`,
          `Your G-Escape flight to ${block.destination_name} is now airborne.`
        );
        results[res.id] = 'airborne_marked';
      }
    }
  } else if (tracking_status === 'APPROACHING') {
    // No state change — just send ETA push
    const etaStr = estimated_arrival_override
      ? new Date(estimated_arrival_override).toLocaleTimeString('en-TT', { hour: '2-digit', minute: '2-digit' })
      : 'soon';

    for (const res of reservations) {
      await sendPush(
        res.rider_id,
        `Approaching ${block.destination_name}`,
        `Landing in approximately 20 minutes. Your ground transfer driver will be at arrivals. ETA ${etaStr}.`
      );
      results[res.id] = 'approaching_push_sent';
    }
  } else if (tracking_status === 'ARRIVED') {
    // Cascade: aviation leg → completed, leg 3 → driver_en_route, itinerary + reservation → ON_ISLAND
    for (const res of reservations) {
      const itin = Array.isArray(res.master_escape_itineraries)
        ? res.master_escape_itineraries[0]
        : res.master_escape_itineraries;
      if (!itin) continue;

      // Close aviation leg
      await supabase
        .from('itinerary_legs')
        .update({ status: 'completed', actual_end: arrivedAt })
        .eq('master_itinerary_id', itin.id)
        .eq('leg_sequence', 2);

      // Activate destination transfer leg
      await supabase
        .from('itinerary_legs')
        .update({ status: 'driver_en_route', actual_start: arrivedAt })
        .eq('master_itinerary_id', itin.id)
        .eq('leg_sequence', 3);

      // Advance itinerary status
      await supabase
        .from('master_escape_itineraries')
        .update({ status: 'ON_ISLAND' })
        .eq('id', itin.id);

      // Advance reservation status
      await supabase
        .from('package_reservations')
        .update({ status: 'ON_ISLAND' })
        .eq('id', res.id);

      // Push rider
      await sendPush(
        res.rider_id,
        `You've landed in ${block.destination_name}! 🏝️`,
        `Welcome. Your ground transfer driver is waiting at arrivals. Open your G-Escape pass to track them.`
      );

      results[res.id] = 'transitioned_to_ON_ISLAND';
    }

    // If there are Tobago-zone drivers registered for pickup, notify them
    // (operator assigns drivers separately — this just sends the trigger)
    const { data: legOperators } = await supabase
      .from('itinerary_legs')
      .select('operator_id')
      .in('master_itinerary_id', reservations
        .map(r => {
          const itin = Array.isArray(r.master_escape_itineraries)
            ? r.master_escape_itineraries[0]
            : r.master_escape_itineraries;
          return itin?.id;
        })
        .filter(Boolean)
      )
      .eq('leg_sequence', 3)
      .not('operator_id', 'is', null);

    const operatorIds = [...new Set((legOperators ?? []).map((l: any) => l.operator_id))];

    if (operatorIds.length > 0) {
      const { data: driverTokens } = await supabase
        .from('profiles')
        .select('id, push_token')
        .in('id', operatorIds)
        .not('push_token', 'is', null);

      for (const d of driverTokens ?? []) {
        if (d.push_token) {
          await supabase.functions.invoke('send_push_notification', {
            body: {
              token: d.push_token,
              title: `Flight landed — proceed to arrivals`,
              body: `G-Escape flight from POS has landed at ${block.destination_code}. Your passengers are on the way out now.`,
            },
          }).catch(() => {});
        }
      }
    }
  } else if (tracking_status === 'DELAYED') {
    // Mark aviation leg as delayed, push update
    const etaStr = estimated_arrival_override
      ? new Date(estimated_arrival_override).toLocaleTimeString('en-TT', { hour: '2-digit', minute: '2-digit' })
      : 'TBD';

    for (const res of reservations) {
      const itin = Array.isArray(res.master_escape_itineraries)
        ? res.master_escape_itineraries[0]
        : res.master_escape_itineraries;
      if (!itin) continue;

      await supabase
        .from('itinerary_legs')
        .update({ status: 'delayed' })
        .eq('master_itinerary_id', itin.id)
        .eq('leg_sequence', 2);

      if (estimated_arrival_override) {
        await supabase
          .from('itinerary_legs')
          .update({ scheduled_end: estimated_arrival_override })
          .eq('master_itinerary_id', itin.id)
          .eq('leg_sequence', 2);
      }

      await sendPush(
        res.rider_id,
        `Flight update`,
        `Your G-Escape flight to ${block.destination_name} is experiencing a delay. New estimated arrival: ${etaStr}. Your ground transfer will adjust.`
      );

      results[res.id] = 'delayed_marked';
    }
  }

  return json({
    tracking_status,
    flight_block_id,
    reservations_processed: reservations.length,
    results,
  });
});
