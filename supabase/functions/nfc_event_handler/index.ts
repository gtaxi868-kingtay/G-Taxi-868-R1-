import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireAuth } from './_shared/auth.ts';
import { checkRateLimit } from './_shared/rateLimit.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { tag_uid, profile_id, lat, lng, nonce } = await req.json();
    const user = await requireAuth(req);

    if (profile_id && profile_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Profile does not match authenticated user' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!tag_uid) {
      return new Response(JSON.stringify({ error: 'tag_uid required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    await checkRateLimit(supabase, user.id, 'nfc_event_handler');

    if (nonce) {
      const { data: existingEvent } = await supabase
        .from('nfc_event_logs')
        .select('id')
        .eq('location_context->>nonce', nonce)
        .maybeSingle();

      if (existingEvent) {
        return new Response(JSON.stringify({ error: 'Duplicate event — nonce already used' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const { data: kiosk } = await supabase
      .from('kiosk_nodes')
      .select('*, merchant:merchant_id(*)')
      .eq('tag_uid', tag_uid)
      .eq('is_active', true)
      .single();

    if (!kiosk) {
      const { data: keychain } = await supabase
        .from('band_keychains')
        .select('id, band_id, label, is_active')
        .eq('tag_uid', tag_uid)
        .eq('is_active', true)
        .maybeSingle();

      if (keychain) {
        const { data: band } = await supabase
          .from('carnival_bands')
          .select('id, name, description, logo_url')
          .eq('id', keychain.band_id)
          .single();

        const { data: events } = await supabase
          .from('carnival_events')
          .select('id, name, venue, lat, lng, event_date, ticket_price_cents')
          .eq('band_id', keychain.band_id)
          .gte('event_date', new Date().toISOString())
          .order('event_date', { ascending: true })
          .limit(5);

        await supabase
          .from('band_members')
          .upsert(
            { rider_id: user.id, band_id: keychain.band_id, keychain_id: keychain.id },
            { onConflict: 'rider_id, band_id' }
          );

        await supabase
          .from('nfc_event_logs')
          .insert({
            tag_uid,
            profile_id: user.id,
            event_type: 'FETESUMMON',
            location_context: { band_id: keychain.band_id, keychain_id: keychain.id },
          })
          .maybeSingle();

        return new Response(
          JSON.stringify({
            type: 'FETESUMMON',
            band: band ? {
              id: band.id,
              name: band.name,
              description: band.description,
              logo_url: band.logo_url,
            } : null,
            events: events || [],
            keychain_label: keychain.label,
            message: band
              ? `Welcome ${band.name} masquerader! Book a ride to your next fete.`
              : 'Carnival band keychain detected!',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({
          type: 'PERSONAL_TAG',
          message: 'Personal Identity Tag detected. No Kiosk context found.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { data: activeRide } = await supabase
      .from('rides')
      .select('id, status')
      .eq('rider_id', user.id)
      .in('status', ['requested', 'searching', 'assigned', 'arrived', 'in_progress'])
      .maybeSingle();

    if (activeRide && !['searching', 'assigned'].includes(activeRide.status)) {
      return new Response(
        JSON.stringify({
          error: 'Cannot use kiosk during an active ride.',
          active_ride_id: activeRide.id,
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    await supabase
      .from('nfc_event_logs')
      .insert({
        tag_uid,
        profile_id: user.id,
        event_type: 'kiosk_tap',
        location_context: {
          lat: lat || kiosk.lat,
          lng: lng || kiosk.lng,
          kiosk_id: kiosk.id,
        },
      })
      .maybeSingle();

    const defaultService = (kiosk.default_services || ['transport'])[0];
    const dispatchableTasks = ['grocery', 'laundry', 'courier'];
    const deliveryMethod = dispatchableTasks.includes(defaultService) ? 'courier' : null;

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        rider_id: user.id,
        merchant_id: kiosk.merchant_id,
        puck_id: tag_uid,
        task_type: defaultService,
        status: 'pending',
        total_cents: 0,
        delivery_method: deliveryMethod,
      })
      .select('id, rider_id, merchant_id, puck_id, task_type, status, total_cents, created_at')
      .single();

    if (orderError) {
      console.error('Failed to create order on kiosk tap:', orderError.message);
    }

    if (order) {
      broadcastTask(kiosk.id, order);
    }

    const { data: partners } = await supabase
      .from('merchants')
      .select('id, name, category')
      .in('category', ['grocery', 'laundry'])
      .limit(5);

    const welcomeMessage = `Welcome to ${kiosk.location_name}. Add Grocery or Laundry to your ride in ONE TAP.`;

    return new Response(
      JSON.stringify({
        type: 'KIOSK_HANDSHAKE',
        welcomeMessage,
        kioskId: kiosk.id,
        locationName: kiosk.location_name,
        pickupCoords: { lat: kiosk.lat ?? lat, lng: kiosk.lng ?? lng },
        availableServices: partners?.map((p) => ({
          id: p.id,
          name: p.name,
          category: p.category,
          icon: p.category === 'grocery' ? 'cart' : 'shirt',
        })) || [],
        order_id: order?.id || null,
        task_type: defaultService,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    if (err instanceof Response) return err;
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});

function broadcastTask(kioskId: string, order: Record<string, unknown>): void {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const channel = supabase.channel(`puck:${kioskId}`);

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channel.send({
          type: 'broadcast',
          event: 'new_task',
          payload: order,
        });
        supabase.removeChannel(channel);
      }
    });
  } catch (e) {
    console.error('Broadcast failed (non-fatal):', e);
  }
}