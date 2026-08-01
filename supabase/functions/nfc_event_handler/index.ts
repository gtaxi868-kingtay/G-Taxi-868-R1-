// Supabase Edge Function: nfc_event_handler
// SINGLE SOURCE OF NFC ROUTING TRUTH
//
// Every NFC/QR touchpoint tap — rider, driver, or merchant — lands here.
// The function resolves the caller's role from profiles, resolves the tag
// (kiosk node, carnival keychain, personal identity tag, or blank), and
// returns a role-appropriate payload including a `route` object that tells
// the app which screen to open. Clients must not route NFC taps locally.
//
// Response contract (all responses):
//   type:  KIOSK_HANDSHAKE | FETESUMMON | PERSONAL_TAG | BLANK_TAG |
//          KIOSK_DRIVER | IDENTITY_MATCH | IDENTITY_MISMATCH | KIOSK_MERCHANT |
//          GEOFENCE_MISMATCH
//   route: { screen: string, params: object } | null

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireAuth } from '../_shared/auth.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Great-circle distance in metres — for the anti-spoof geofence handshake.
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { tag_uid, profile_id, lat, lng, nonce, ride_id, confirm_location } = await req.json();
    const user = await requireAuth(req);

    if (profile_id && profile_id !== user.id) {
      return json({ error: 'Profile does not match authenticated user' }, 403);
    }

    if (!tag_uid) {
      return json({ error: 'tag_uid required' }, 400);
    }

    // Normalize: accept raw UIDs, printed codes, and https://…/node/<uid> QR URLs
    const tagUid = String(tag_uid).replace(/^https?:\/\/[^\/]+\/(node|nfc)\//, '').trim();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    await checkRateLimit(supabase, user.id, 'nfc_event_handler');

    if (nonce) {
      const { data: existingEvent } = await supabase
        .from('nfc_event_logs')
        .select('id')
        .eq('location_context->>nonce', nonce)
        .maybeSingle();

      if (existingEvent) {
        return json({ error: 'Duplicate event — nonce already used' }, 409);
      }
    }

    // ── ROLE RESOLUTION ─────────────────────────────────────────────────────
    // rides.driver_id holds drivers.id (not the auth uid), so resolve both.
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, merchant_id, full_name')
      .eq('id', user.id)
      .maybeSingle();

    const role: string = profile?.role || 'rider';

    // ── TAG RESOLUTION ──────────────────────────────────────────────────────
    const { data: kiosk } = await supabase
      .from('kiosk_nodes')
      .select('*, merchant:merchant_id(*)')
      .eq('tag_uid', tagUid)
      .eq('is_active', true)
      .single();

    // ── ANTI-SPOOF GEOFENCE HANDSHAKE ───────────────────────────────────────
    // A cloned chip or photographed QR can be tapped from anywhere. If the tag
    // is a physical kiosk with a known location + radius and the device sent
    // its GPS, require the tapper to actually be near the tag. GPS is noisy so
    // we add slack and SOFT-block (a confirm prompt) rather than hard-fail — an
    // honest user taps "I'm here"; a cloner at home sees the mismatch. Callers
    // pass confirm_location:true to proceed past the prompt. The mismatch is
    // logged WITHOUT the nonce so the confirm-retry (same nonce) isn't
    // rejected by the dedup guard above.
    if (
      kiosk && kiosk.lat != null && kiosk.lng != null &&
      typeof lat === 'number' && typeof lng === 'number' && !confirm_location
    ) {
      const radiusM = kiosk.geofence_radius_m ?? 150;
      const GPS_SLACK_M = 75;
      const distM = haversineMeters(lat, lng, kiosk.lat, kiosk.lng);

      if (distM > radiusM + GPS_SLACK_M) {
        await supabase.from('nfc_event_logs').insert({
          tag_uid: tagUid,
          profile_id: user.id,
          event_type: 'geofence_mismatch',
          location_context: {
            kiosk_id: kiosk.id, lat, lng,
            distance_m: Math.round(distM), radius_m: radiusM,
          },
        }).maybeSingle();

        return json({
          type: 'GEOFENCE_MISMATCH',
          require_confirm: true,
          distance_m: Math.round(distM),
          radius_m: radiusM,
          kioskId: kiosk.id,
          locationName: kiosk.location_name,
          message: `You seem to be about ${Math.round(distM)}m from ${kiosk.location_name}. Tap confirm if you're really here.`,
          route: null,
        });
      }
    }
    const locationVerified =
      kiosk && kiosk.lat != null && kiosk.lng != null &&
      typeof lat === 'number' && typeof lng === 'number' && !confirm_location;

    // ════════════════════════ DRIVER BRANCH ═════════════════════════════════
    if (role === 'driver') {
      const { data: driverRecord } = await supabase
        .from('drivers')
        .select('id, name')
        .eq('user_id', user.id)
        .maybeSingle();

      const { data: activeRide } = driverRecord
        ? await supabase
            .from('rides')
            .select('id, rider_id, status')
            .eq('driver_id', driverRecord.id)
            .in('status', ['assigned', 'arrived', 'in_progress'])
            .maybeSingle()
        : { data: null };

      // Driver tapped a kiosk/stand: informational — never creates an order.
      if (kiosk) {
        await supabase.from('nfc_event_logs').insert({
          tag_uid: tagUid,
          profile_id: user.id,
          event_type: 'kiosk_tap_driver',
          location_context: { kiosk_id: kiosk.id, lat: lat || kiosk.lat, lng: lng || kiosk.lng, nonce, location_verified: locationVerified },
        }).maybeSingle();

        return json({
          type: 'KIOSK_DRIVER',
          kioskId: kiosk.id,
          locationName: kiosk.location_name,
          message: activeRide
            ? `You are at ${kiosk.location_name}. Continue your active trip.`
            : `You are at ${kiosk.location_name}. Stay nearby to receive ride requests from this stand.`,
          route: activeRide
            ? { screen: 'ActiveTrip', params: { rideId: activeRide.id } }
            : { screen: 'Dashboard', params: {} },
        });
      }

      // Driver tapped a tag: resolve the rider ANY tag type (keychain,
      // identity_tag, nfc_tag) through unified_identities so a Carnival
      // band keychain works for settlement verification.
      const { data: tagProfile } = await supabase.rpc('resolve_tag_to_profile', {
        p_tag_uid: tagUid,
      });

      const resolvedProfileId: string | null = tagProfile?.found
        ? tagProfile.profile_id
        : null;

      // Fallback: direct identity_tags lookup for backward compatibility
      // with tags registered before unified_identities existed.
      const { data: legacyTag } = !resolvedProfileId
        ? await supabase
            .from('identity_tags')
            .select('tag_uid, profile_id, is_active')
            .eq('tag_uid', tagUid)
            .maybeSingle()
        : { data: null };

      const profileId = resolvedProfileId || legacyTag?.profile_id || null;
      const isActive = tagProfile?.found ? true : (legacyTag?.is_active ?? true);

      if (profileId) {
        if (!isActive) {
          return json({ type: 'IDENTITY_MISMATCH', error: 'This tag has been deactivated.' });
        }

        const rideForCheck = ride_id && activeRide?.id === ride_id ? activeRide : activeRide;
        const matches = !!rideForCheck && profileId === rideForCheck.rider_id;

        const { data: tagOwner } = matches
          ? await supabase.from('profiles').select('full_name').eq('id', profileId).single()
          : { data: null };

        await supabase.from('nfc_event_logs').insert({
          tag_uid: tagUid,
          profile_id: user.id,
          event_type: matches ? 'identity_verified' : 'identity_mismatch',
          location_context: { ride_id: rideForCheck?.id || null, nonce },
        }).maybeSingle();

        if (matches) {
          return json({
            type: 'IDENTITY_MATCH',
            rider_name: tagOwner?.full_name || 'Rider',
            ride_id: rideForCheck!.id,
            message: `Identity verified: ${tagOwner?.full_name || 'Rider'}`,
            route: { screen: 'ActiveTrip', params: { rideId: rideForCheck!.id } },
          });
        }

        return json({
          type: 'IDENTITY_MISMATCH',
          error: rideForCheck
            ? 'This Universal Key does not belong to your assigned rider.'
            : 'No active ride — nothing to verify this key against.',
          route: null,
        });
      }

      return json({
        type: 'BLANK_TAG',
        message: 'Unrecognized tag. Ask an admin to provision it.',
        route: null,
      });
    }

    // ════════════════════════ MERCHANT BRANCH ═══════════════════════════════
    if (role === 'merchant') {
      let merchantId: string | null = profile?.merchant_id || null;
      if (!merchantId) {
        const { data: ownMerchant } = await supabase
          .from('merchants')
          .select('id')
          .eq('created_by', user.id)
          .maybeSingle();
        merchantId = ownMerchant?.id || null;
      }

      if (kiosk) {
        const ownsKiosk = !!merchantId && kiosk.merchant_id === merchantId;

        const { data: pendingOrders } = ownsKiosk
          ? await supabase
              .from('orders')
              .select('id, task_type, status, created_at')
              .eq('merchant_id', merchantId)
              .eq('puck_id', tagUid)
              .in('status', ['pending', 'accepted'])
              .order('created_at', { ascending: false })
              .limit(10)
          : { data: [] };

        await supabase.from('nfc_event_logs').insert({
          tag_uid: tagUid,
          profile_id: user.id,
          event_type: 'kiosk_tap_merchant',
          location_context: { kiosk_id: kiosk.id, owns_kiosk: ownsKiosk, nonce, location_verified: locationVerified },
        }).maybeSingle();

        return json({
          type: 'KIOSK_MERCHANT',
          kioskId: kiosk.id,
          locationName: kiosk.location_name,
          owns_kiosk: ownsKiosk,
          pending_orders: pendingOrders || [],
          message: ownsKiosk
            ? `${kiosk.location_name}: ${(pendingOrders || []).length} open order(s) from this puck.`
            : `This node belongs to another merchant.`,
          route: ownsKiosk ? { screen: 'Orders', params: { puckId: tagUid } } : null,
        });
      }

      return json({
        type: 'BLANK_TAG',
        message: 'Unrecognized tag. Contact G-Taxi to provision a node for your store.',
        route: null,
      });
    }

    // ════════════════════════ RIDER BRANCH (default) ════════════════════════
    if (!kiosk) {
      // Check if this is a carnival band keychain
      const { data: keychain } = await supabase
        .from('band_keychains')
        .select('id, band_id, label, is_active')
        .eq('tag_uid', tagUid)
        .eq('is_active', true)
        .maybeSingle();

      if (keychain) {
        // Fetch band info + upcoming events
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

        // Upsert band membership (idempotent)
        await supabase
          .from('band_members')
          .upsert(
            { rider_id: user.id, band_id: keychain.band_id, keychain_id: keychain.id },
            { onConflict: 'rider_id, band_id' }
          );

        // Link this band keychain to the rider's unified identity so drivers
        // can verify them via resolve_tag_to_profile at settlement time.
        await supabase.rpc('register_unified_identity_admin', {
          p_profile_id: user.id,
          p_tag_uid: tagUid,
          p_tag_type: 'keychain',
          p_label: keychain.label || `Band keychain — ${keychain.band_id}`,
          p_metadata: { band_id: keychain.band_id, keychain_id: keychain.id },
        }).then(undefined, () => {}); // non-fatal

        // Log event
        await supabase
          .from('nfc_event_logs')
          .insert({
            tag_uid: tagUid,
            profile_id: user.id,
            event_type: 'FETESUMMON',
            location_context: { band_id: keychain.band_id, keychain_id: keychain.id, nonce },
          })
          .maybeSingle();

        return json({
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
          route: null,
        });
      }

      // Check unified_identities for any registered tag (identity_tag,
      // nfc_tag, or keychain that wasn't caught by FETESUMMON above,
      // e.g. a personal NFC tag vs. a band keychain).
      const { data: knownTag } = await supabase.rpc('resolve_tag_to_profile', {
        p_tag_uid: tagUid,
      });

      if (knownTag?.found) {
        // Falling through to here means the tag is unified but not a
        // band keychain (already handled by FETESUMMON above).
        return json({
          type: 'PERSONAL_TAG',
          is_own: knownTag.profile_id === user.id,
          tag_type: knownTag.tag_type,
          message: knownTag.profile_id === user.id
            ? 'This is your Universal Key.'
            : 'Registered tag detected. No Kiosk context found.',
          route: null,
        });
      }

      return json({
        type: 'BLANK_TAG',
        message: 'Unprovisioned tag detected.',
        route: { screen: 'TagMarker', params: { tagUid } },
      });
    }

    const { data: activeRide } = await supabase
      .from('rides')
      .select('id, status')
      .eq('rider_id', user.id)
      .in('status', ['requested', 'searching', 'assigned', 'arrived', 'in_progress'])
      .maybeSingle();

    if (activeRide && !['searching', 'assigned'].includes(activeRide.status)) {
      return json({
        error: 'Cannot use kiosk during an active ride.',
        active_ride_id: activeRide.id,
      }, 409);
    }

    await supabase
      .from('nfc_event_logs')
      .insert({
        tag_uid: tagUid,
        profile_id: user.id,
        event_type: 'kiosk_tap',
        location_context: {
          lat: lat || kiosk.lat,
          lng: lng || kiosk.lng,
          kiosk_id: kiosk.id,
          nonce,
          location_verified: locationVerified,
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
        puck_id: tagUid,
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

    const pickup = {
      latitude: kiosk.lat ?? lat ?? 0,
      longitude: kiosk.lng ?? lng ?? 0,
      address: kiosk.location_name || 'G-Taxi NFC Kiosk',
    };

    // Merchant-anchored kiosks route to service booking; pure stands go
    // straight to destination search with the stand as pickup.
    const route = kiosk.merchant_id
      ? {
          screen: 'ServiceBooking',
          params: {
            merchantId: kiosk.merchant_id,
            merchantName: kiosk.merchant?.name,
            kioskNodeId: kiosk.id,
            tagUid,
            pickup,
          },
        }
      : {
          screen: 'DestinationSearch',
          params: {
            currentLocation: pickup,
            source: 'nfc_kiosk',
            kioskId: kiosk.id,
            sourceMetadata: {
              kioskId: kiosk.id,
              locationName: kiosk.location_name,
              tagUid,
            },
          },
        };

    return json({
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
      route,
    });
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
