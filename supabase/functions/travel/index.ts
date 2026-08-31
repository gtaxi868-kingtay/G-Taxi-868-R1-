import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RESERVE_RATE = 0.015;
const PIARCO_LAT = 10.5954;
const PIARCO_LNG = -61.3372;
const POS_CENTER_LAT = 10.6549;
const POS_CENTER_LNG = -61.5019;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

async function notifyPoolMembers(
  supabase: ReturnType<typeof createClient>,
  packageId: string,
  newRiderId: string,
  guestCount: number,
) {
  const { data: pool } = await supabase
    .from('package_reservations')
    .select('rider_id')
    .eq('escape_package_id', packageId)
    .in('status', ['CAPTURED', 'ACTIVE_HOLD'])
    .neq('rider_id', newRiderId);
  if (!pool || pool.length === 0) return;

  const { data: pkg } = await supabase
    .from('escape_packages')
    .select('flight_blocks(tipping_point_seats, allocated_seats)')
    .eq('id', packageId)
    .single();
  const fb = Array.isArray(pkg?.flight_blocks) ? pkg.flight_blocks[0] : pkg?.flight_blocks;
  const seatsLeft = fb ? Math.max(0, fb.tipping_point_seats - fb.allocated_seats) : null;
  if (seatsLeft === null) return;

  const joined = guestCount > 1 ? `${guestCount} people just joined` : 'Someone just joined';
  const body = seatsLeft > 0
    ? `${joined} your pool — ${seatsLeft} more seat${seatsLeft !== 1 ? 's' : ''} to lock the flight!`
    : `${joined} — tipping point reached! Your flight is being confirmed.`;

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  await fetch(`${supabaseUrl}/functions/v1/send_push_notification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
    body: JSON.stringify({
      user_ids: pool.map((m: { rider_id: string }) => m.rider_id),
      title: seatsLeft > 0 ? 'Pool filling up!' : 'Flight confirmed!',
      body,
      data: { type: 'escape_pool_update', escape_package_id: packageId },
    }),
  }).catch(() => {});
}

function parseICalDates(icalText: string): Set<string> {
  const bookedDates = new Set<string>();
  const vevents = icalText.split('BEGIN:VEVENT');
  for (let i = 1; i < vevents.length; i++) {
    const vevent = vevents[i];
    const dtStartMatch = vevent.match(/DTSTART(?:;[^:]*)?:(\d{8})/);
    const dtEndMatch = vevent.match(/DTEND(?:;[^:]*)?:(\d{8})/);
    if (!dtStartMatch || !dtEndMatch) continue;
    const startStr = dtStartMatch[1];
    const endStr = dtEndMatch[1];
    const start = new Date(parseInt(startStr.slice(0, 4)), parseInt(startStr.slice(4, 6)) - 1, parseInt(startStr.slice(6, 8)));
    const end = new Date(parseInt(endStr.slice(0, 4)), parseInt(endStr.slice(4, 6)) - 1, parseInt(endStr.slice(6, 8)));
    const cur = new Date(start);
    while (cur < end) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, '0');
      const d = String(cur.getDate()).padStart(2, '0');
      bookedDates.add(`${y}-${m}-${d}`);
      cur.setDate(cur.getDate() + 1);
    }
  }
  return bookedDates;
}

function dateRange(days: number): string[] {
  const dates: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${day}`);
  }
  return dates;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const authHeader = req.headers.get('Authorization');
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader?.replace('Bearer ', '') ?? ''
  );
  if (authError || !user) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const { action } = body;

  try {
    switch (action) {

      // ── book_travel_package ─────────────────────────────────────────────
      case 'book_travel_package': {
        const {
          package_id,
          traveler_count = 1,
          payment_method = 'wallet',
          passenger_names = [],
          special_requests,
        } = body;

        if (!package_id) return json({ error: 'package_id required' }, 400);
        if (!['wallet', 'stripe'].includes(payment_method)) {
          return json({ error: 'payment_method must be wallet or stripe' }, 400);
        }

        const { data: bookResult, error: rpcErr } = await supabase.rpc('book_travel_atomic', {
          p_user_id: user.id,
          p_package_id: package_id,
          p_traveler_count: traveler_count,
          p_payment_method: payment_method,
          p_passenger_names: JSON.stringify(passenger_names),
          p_special_requests: special_requests ?? null,
        });

        if (rpcErr) {
          const msg = rpcErr.message || '';
          if (msg.includes('sold_out') || msg.includes('seats')) {
            return json({ error: 'Package is sold out or insufficient seats' }, 409);
          }
          if (msg.includes('insufficient') || msg.includes('balance')) {
            return json({ error: 'Insufficient wallet balance' }, 402);
          }
          return json({ error: msg || 'Booking failed' }, 500);
        }

        const result = bookResult as any;
        const booking_id: string = result.booking_id;
        const total_cents: number = result.total_cents;
        const platform_margin_cents: number = result.platform_margin_cents;
        const includes_airport_transfer: boolean = result.includes_airport_transfer;
        const package_title: string = result.package_title;
        const departure_at: string = result.departure_at;

        const reserveCents = Math.round(total_cents * RESERVE_RATE);
        await supabase.from('capital_reserve_ledger').insert({
          source_booking_id: booking_id,
          amount_cents: reserveCents,
          status: 'locked',
          source: 'travel_package',
          notes: `Travel booking ${booking_id} — ${package_title}`,
        }).then((__r) => __r, () => {});

        await supabase.from('platform_revenue_logs').insert({
          source: 'travel_package',
          gross_cents: total_cents,
          platform_margin_cents,
          reserve_cents: reserveCents,
          metadata: { booking_id, package_id, traveler_count, payment_method },
        }).then((__r) => __r, () => {});

        const { data: riderProfile } = await supabase
          .from('profiles')
          .select('home_address, home_lat, home_lng, push_token')
          .eq('id', user.id)
          .single();

        let airport_transfer_ride_id: string | null = null;
        if (includes_airport_transfer && departure_at) {
          try {
            const hasHomeCoords = riderProfile?.home_lat && riderProfile?.home_lng;
            const scheduledFor = new Date(new Date(departure_at).getTime() - 2 * 60 * 60 * 1000).toISOString();
            const { data: ride } = await supabase.from('rides').insert({
              rider_id: user.id,
              pickup_address: riderProfile?.home_address || 'Port of Spain (update in My Bookings)',
              pickup_lat: hasHomeCoords ? riderProfile.home_lat : POS_CENTER_LAT,
              pickup_lng: hasHomeCoords ? riderProfile.home_lng : POS_CENTER_LNG,
              dropoff_address: 'Piarco International Airport (POS)',
              dropoff_lat: PIARCO_LAT,
              dropoff_lng: PIARCO_LNG,
              status: 'scheduled',
              payment_method: 'corporate_billing',
              scheduled_for: scheduledFor,
              notes: `Auto-booked airport transfer for: ${package_title}. Booking ref: ${booking_id}`,
              booking_ref: booking_id,
            }).select('id').single();

            if (ride) {
              airport_transfer_ride_id = ride.id;
              await supabase.from('travel_bookings').update({ airport_transfer_ride_id: ride.id }).eq('id', booking_id);
            }
          } catch {}
        }

        if (riderProfile?.push_token) {
          try {
            const daysUntil = Math.max(1, Math.ceil(
              (new Date(departure_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
            ));
            const departureStr = new Date(departure_at).toLocaleDateString('en-TT', {
              weekday: 'short', day: 'numeric', month: 'short',
            });
            const transferLine = airport_transfer_ride_id ? ' Your airport transfer is pre-booked.' : '';
            await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send_push_notification`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                user_id: user.id,
                title: `Booking confirmed — ${package_title}`,
                body: `${daysUntil} day${daysUntil !== 1 ? 's' : ''} until ${departureStr}.${transferLine}`,
                data: { type: 'travel_booking_confirmed', booking_id, package_id, screen: 'TravelMyBookings' },
              }),
            }).catch(() => {});
          } catch {}
        }

        return json({
          booking_id, package_title, total_cents, platform_margin_cents,
          traveler_count, departure_at, airport_transfer_ride_id, reserve_cents: reserveCents,
        });
      }

      // ── book_escape ─────────────────────────────────────────────────────
      case 'book_escape': {
        const {
          escape_package_id,
          guest_count = 1,
          payment_method = 'wipay',
          return_url = 'gtaxi://escape',
          pickup_address,
          pickup_lat,
          pickup_lng,
          passenger_names = [],
          special_requests,
        } = body;

        if (!escape_package_id) return json({ error: 'escape_package_id required' }, 400);
        if (!['wipay', 'stripe', 'wallet'].includes(payment_method)) {
          return json({ error: 'payment_method must be wipay, stripe, or wallet' }, 400);
        }

        const { data: existing } = await supabase
          .from('package_reservations')
          .select('id, stripe_payment_intent_id, total_price_cents, hold_expires_at, booking_ref')
          .eq('rider_id', user.id)
          .eq('escape_package_id', escape_package_id)
          .eq('status', 'ACTIVE_HOLD')
          .gte('hold_expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existing) {
          return json({
            reservation_id: existing.id,
            booking_ref: existing.booking_ref,
            total_price_cents: existing.total_price_cents,
            hold_expires_at: existing.hold_expires_at,
            payment_method,
            status: 'ACTIVE_HOLD',
            resumed: true,
          });
        }

        const { data: holdRows, error: rpcError } = await supabase.rpc('secure_escape_booking', {
          p_escape_package_id: escape_package_id,
          p_rider_id: user.id,
          p_guest_count: guest_count,
          p_payment_method: payment_method,
          p_pickup_address: pickup_address ?? null,
          p_pickup_lat: pickup_lat ?? null,
          p_pickup_lng: pickup_lng ?? null,
          p_passenger_names: passenger_names,
          p_special_requests: special_requests ?? null,
        });

        if (rpcError) {
          console.error('secure_escape_booking error:', rpcError);
          return json({ error: rpcError.message || 'Booking failed' }, 500);
        }

        const hold = Array.isArray(holdRows) ? holdRows[0] : holdRows;
        if (!hold?.success) {
          const status = hold?.message?.includes('cancelled') ? 410
            : hold?.message?.includes('seat') ? 409
            : hold?.message?.includes('Guest count') ? 422 : 400;
          return json({
            error: hold?.message || 'Hold failed',
            seats_remaining: hold?.seats_remaining ?? null,
            requires_verification: hold?.requires_verification ?? false,
          }, status);
        }

        const reservationId: string = hold.reservation_id;
        const totalCents: number = hold.total_price_cents;
        const holdExpiresAt: string = hold.hold_expires_at;
        const seatsRemaining: number = hold.seats_remaining;
        const requiresVerification: boolean = hold.requires_verification;

        const { data: resRow } = await supabase
          .from('package_reservations')
          .select('booking_ref')
          .eq('id', reservationId)
          .single();
        const bookingRef: string | null = resRow?.booking_ref ?? null;

        const releaseHold = async () => {
          try { await supabase.rpc('release_single_reservation', { p_reservation_id: reservationId }); } catch (e) { console.error('[travel] release failed:', reservationId, e); }
        };

        if (payment_method === 'wallet') {
          const { data: captureRows, error: captureError } = await supabase.rpc(
            'capture_escape_wallet_payment',
            { p_reservation_id: reservationId, p_rider_id: user.id }
          );
          const capture = Array.isArray(captureRows) ? captureRows[0] : captureRows;
          if (captureError || !capture?.success) {
            await releaseHold();
            return json({ error: capture?.message || captureError?.message || 'Insufficient wallet balance' }, 402);
          }
          notifyPoolMembers(supabase, escape_package_id, user.id, guest_count).catch(() => {});
          return json({
            reservation_id: reservationId, booking_ref: bookingRef, total_price_cents: totalCents,
            hold_expires_at: holdExpiresAt, seats_remaining: seatsRemaining,
            requires_verification: requiresVerification, payment_method: 'wallet', status: 'CAPTURED',
          });
        }

        // ── WiPay (primary) ────────────────────────────────────────────
        if (payment_method === 'wipay') {
          const WIPAY_ACCOUNT_NUMBER = Deno.env.get('WIPAY_ACCOUNT_NUMBER') ?? '';
          const WIPAY_API_KEY = Deno.env.get('WIPAY_API_KEY') ?? '';
          const WIPAY_ENV = Deno.env.get('WIPAY_ENV') ?? 'sandbox';

          if (!WIPAY_ACCOUNT_NUMBER || !WIPAY_API_KEY) {
            // Fall back to Stripe if WiPay not configured
            console.log('WiPay not configured, falling back to Stripe');
          } else {
            const WIPAY_BASE_URL = WIPAY_ENV === 'live'
              ? 'https://wipayfinancial.com/v1/gateway'
              : 'https://sandbox.wipayfinancial.com/v1/gateway'

            const orderId = `gescape-${reservationId.slice(0, 8)}-${reservationId}`
            const totalTTD = (totalCents / 100).toFixed(2)

            await supabase
              .from('wipay_sessions')
              .insert({
                user_id: user.id,
                order_id: orderId,
                form_fields: { reservation_id: reservationId, escape_package_id },
                status: 'pending',
              })
              .then((__r) => __r, (err: unknown) => console.error('[book_escape] wipay_session insert error:', err))

            const wipayParams = new URLSearchParams({
              account_number: WIPAY_ACCOUNT_NUMBER,
              avs: '0',
              currency: 'TTD',
              environment: WIPAY_ENV,
              fee_structure: 'merchant_absorb',
              method: 'credit_card',
              order_id: orderId,
              return_url,
              total: totalTTD,
            })

            const redirectUrl = `${WIPAY_BASE_URL}?${wipayParams.toString()}`

            return json({
              reservation_id: reservationId, booking_ref: bookingRef,
              total_price_cents: totalCents, hold_expires_at: holdExpiresAt,
              seats_remaining: seatsRemaining,
              requires_verification: requiresVerification,
              payment_method: 'wipay',
              status: 'ACTIVE_HOLD',
              redirect_url: redirectUrl,
              order_id: orderId,
            })
          }
        }

        // ── Stripe (fallback) ──────────────────────────────────────────
        const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
        if (!stripeKey) {
          await releaseHold();
          return json({ error: 'Payment processing not configured' }, 503);
        }

        let clientSecret: string;
        let paymentIntentId: string;
        try {
          const stripe = new Stripe(stripeKey, {
            apiVersion: '2023-10-16',
            httpClient: Stripe.createFetchHttpClient(),
          });
          const intent = await stripe.paymentIntents.create({
            amount: totalCents,
            currency: 'ttd',
            capture_method: 'manual',
            payment_method_types: ['card'],
            metadata: {
              reservation_id: reservationId, booking_ref: bookingRef ?? '',
              escape_package_id, rider_id: user.id, guest_count: String(guest_count),
              hold_expires_at: holdExpiresAt, source: 'g_escape_booking',
            },
          });
          clientSecret = intent.client_secret!;
          paymentIntentId = intent.id;
        } catch (err: any) {
          console.error('Stripe PaymentIntent error:', err.message);
          await releaseHold();
          return json({ error: err.message || 'Payment setup failed' }, 502);
        }

        await supabase.from('package_reservations')
          .update({ stripe_payment_intent_id: paymentIntentId, updated_at: new Date().toISOString() })
          .eq('id', reservationId);

        notifyPoolMembers(supabase, escape_package_id, user.id, guest_count).catch(() => {});
        return json({
          reservation_id: reservationId, booking_ref: bookingRef, total_price_cents: totalCents,
          hold_expires_at: holdExpiresAt, seats_remaining: seatsRemaining,
          requires_verification: requiresVerification, payment_method: 'stripe', status: 'ACTIVE_HOLD',
          client_secret: clientSecret,
        });
      }

      // ── join_escape_group ───────────────────────────────────────────────
      case 'join_escape_group': {
        const { package_id, party_size, time_preference, pickup_note } = body;
        if (!package_id) return json({ error: 'package_id is required' }, 400);
        if (party_size && (party_size < 1 || party_size > 20)) {
          return json({ error: 'party_size must be 1-20' }, 400);
        }

        const { data: pkg } = await supabase
          .from('escape_packages')
          .select('id, package_name, max_total_guests, allocated_guests, is_active, price_per_person_cents')
          .eq('id', package_id)
          .eq('is_active', true)
          .single();

        if (!pkg) return json({ error: 'Package not found or inactive' }, 404);
        if (pkg.max_total_guests && pkg.allocated_guests + (party_size || 1) > pkg.max_total_guests) {
          return json({ error: 'Not enough capacity' }, 409);
        }

        const { data: existing } = await supabase
          .from('escape_group_participants')
          .select('id, status')
          .eq('package_id', package_id)
          .eq('rider_id', user.id)
          .single();

        if (existing) {
          return json({
            error: 'Already joined this package', participant_id: existing.id, status: existing.status,
          }, 409);
        }

        const { data: participant, error: insertErr } = await supabase
          .from('escape_group_participants')
          .insert({
            package_id, rider_id: user.id, status: 'intent_pending',
            party_size: party_size || 1, time_preference: time_preference || null,
            pickup_note: pickup_note || null,
          })
          .select('id, status, party_size, joined_at')
          .single();

        if (insertErr) return json({ error: 'Failed to join', detail: insertErr.message }, 500);

        await supabase.rpc('increment_allocated_guests', {
          p_package_id: package_id, p_increment: party_size || 1,
        }).then((__r) => __r, () => {});

        return json({
          participant,
          package_name: pkg.package_name,
          price_per_person_cents: pkg.price_per_person_cents,
          estimated_total_cents: (party_size || 1) * pkg.price_per_person_cents,
        });
      }

      // ── auto_charge_escape_group ────────────────────────────────────────
      case 'auto_charge_escape_group': {
        const { data: packages } = await supabase
          .from('escape_packages')
          .select('id, package_name, price_per_person_cents, allocated_guests, min_guests_threshold, charge_deadline')
          .eq('is_active', true)
          .not('min_guests_threshold', 'is', null);

        let charged = 0;
        let failed = 0;
        const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;

        const readyPackages = (packages || []).filter(
          (p: any) => p.allocated_guests >= (p.min_guests_threshold || 999999)
        );

        for (const pkg of readyPackages) {
          const { data: participants } = await supabase
            .from('escape_group_participants')
            .select('id, rider_id, party_size, status, paid_cents')
            .eq('package_id', pkg.id)
            .eq('status', 'intent_pending');

          if (!participants || participants.length === 0) continue;

          for (const p of participants) {
            const amount_cents = p.party_size * (pkg as any).price_per_person_cents;

            const { data: wallets } = await supabase
              .from('wallets')
              .select('balance_cents')
              .eq('user_id', p.rider_id);

            const wallet = wallets?.[0];
            if (wallet && wallet.balance_cents >= amount_cents) {
              const { data: deductResult, error: deductErr } = await supabase
                .rpc('charge_escape_participant_wallet', {
                  p_rider_id: p.rider_id, p_amount_cents: amount_cents,
                  p_package_name: (pkg as any).package_name, p_reference_id: p.id,
                });

              if (!deductErr) {
                const { error: updateErr } = await supabase
                  .from('escape_group_participants')
                  .update({
                    status: 'confirmed', paid_cents: amount_cents,
                    charged_at: new Date().toISOString(), confirmed_at: new Date().toISOString(),
                  })
                  .eq('id', p.id);

                if (!updateErr) {
                  await supabase.rpc('increment_confirmed_guests', {
                    p_package_id: pkg.id, p_increment: p.party_size,
                  }).then((__r) => __r, () => {});
                  charged++;
                } else {
                  failed++;
                }
              } else {
                await supabase.from('escape_group_participants')
                  .update({ status: 'payment_pending' }).eq('id', p.id);
                failed++;
              }
            } else if (STRIPE_SECRET_KEY) {
              try {
                const stripeResp = await fetch('https://api.stripe.com/v1/payment_intents', {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                  },
                  body: new URLSearchParams({
                    amount: String(amount_cents), currency: 'ttd',
                    'metadata[participant_id]': p.id,
                    'metadata[package_name]': (pkg as any).package_name,
                    'metadata[type]': 'escape_group_booking',
                    description: `Escape group: ${(pkg as any).package_name} (${p.party_size} pax)`,
                  }),
                });
                if (stripeResp.ok) {
                  const pi = await stripeResp.json();
                  await supabase.from('escape_group_participants')
                    .update({ status: 'payment_pending', stripe_pi_id: pi.id }).eq('id', p.id);
                }
                failed++;
              } catch {
                failed++;
              }
            } else {
              failed++;
            }
          }
        }

        return json({
          charged, failed,
          packages_scanned: (packages || []).length,
          ready_packages: readyPackages.length,
        });
      }

      // ── cancel_booking ──────────────────────────────────────────────────
      case 'cancel_booking': {
        const { booking_id } = body;
        if (!booking_id) return json({ error: 'booking_id required' }, 400);

        const { data: booking, error: fetchErr } = await supabase
          .from('travel_bookings')
          .select(`
            id, user_id, status, total_cents, payment_method, wallet_transaction_id,
            airport_transfer_ride_id,
            travel_packages(departure_at, title, destination_name)
          `)
          .eq('id', booking_id)
          .single();

        if (fetchErr || !booking) return json({ error: 'Booking not found' }, 404);
        if (booking.user_id !== user.id) return json({ error: 'Forbidden' }, 403);
        if (booking.status === 'cancelled') return json({ error: 'Booking already cancelled' }, 409);
        if (booking.status === 'completed') return json({ error: 'Cannot cancel a completed booking' }, 409);

        const pkg = (booking as any).travel_packages;
        if (pkg?.departure_at) {
          const hoursUntil = (new Date(pkg.departure_at).getTime() - Date.now()) / (1000 * 60 * 60);
          if (hoursUntil < 24) return json({ error: 'Cannot cancel within 24 hours of departure' }, 422);
        }

        const { data: cancelled, error: cancelErr } = await supabase
          .from('travel_bookings')
          .update({ status: 'cancelled' })
          .eq('id', booking_id)
          .in('status', ['pending', 'confirmed'])
          .select('id')
          .maybeSingle();

        if (cancelErr) return json({ error: cancelErr.message }, 500);
        if (!cancelled) return json({ error: 'Booking already cancelled or not in cancellable state' }, 409);

        let refunded = false;
        if (booking.payment_method === 'wallet' && booking.total_cents > 0) {
          const { error: refundErr } = await supabase.rpc('credit_wallet', {
            p_user_id: user.id,
            p_amount_cents: booking.total_cents,
            p_type: 'travel_package_refund',
            p_description: `Refund for cancelled trip to ${pkg?.destination_name || 'Caribbean'}`,
            p_reference_id: booking_id,
          }).then((__r) => __r, () => ({ error: { message: 'RPC not found, insert directly' } }));

          if (refundErr) {
            const { data: wallet } = await supabase
              .from('wallets').select('id, balance_cents').eq('user_id', user.id).single();
            if (wallet) {
              await supabase.from('wallets').update({ balance_cents: wallet.balance_cents + booking.total_cents }).eq('id', wallet.id);
              await supabase.from('wallet_transactions').insert({
                user_id: user.id, amount: booking.total_cents,
                transaction_type: 'travel_package_refund',
                description: `Refund: ${pkg?.title || 'Caribbean package'} cancelled`,
                status: 'completed', reference_id: booking_id,
              });
            }
          }
          refunded = !refundErr;
        }

        if ((booking as any).airport_transfer_ride_id) {
          await supabase.from('rides')
            .update({ status: 'cancelled' })
            .eq('id', (booking as any).airport_transfer_ride_id)
            .in('status', ['searching', 'scheduled'])
            .then((__r) => __r, () => {});
        }

        await supabase.from('capital_reserve_ledger')
          .update({ status: 'released', notes: `Travel booking ${booking_id} cancelled` })
          .eq('source_booking_id', booking_id)
          .eq('status', 'locked')
          .then((__r) => __r, () => {});

        return json({
          cancelled: true, booking_id, refunded,
          refund_amount_cents: refunded ? booking.total_cents : 0,
          message: refunded
            ? `Refund of TTD \$${(booking.total_cents / 100).toFixed(2)} will appear in your wallet shortly.`
            : 'Booking cancelled. No refund applicable.',
        });
      }

      // ── get_packages ────────────────────────────────────────────────────
      case 'get_packages': {
        const url = new URL(req.url);
        const destination_code = url.searchParams.get('destination_code') || body.destination_code || undefined;
        const departure_month = url.searchParams.get('departure_month') || body.departure_month || undefined;
        const max_price_cents = parseInt(url.searchParams.get('max_price_cents') || body.max_price_cents) || undefined;
        const package_id = body.package_id || undefined;

        let query = supabase
          .from('travel_packages')
          .select(`
            id, title, destination_code, destination_name, origin_code,
            cover_image_url, property_id, flight_inventory_id,
            flight_info, hotel_info,
            price_per_person_cents, max_travelers, travelers_booked,
            includes_airport_transfer, status, departure_at, expires_at, created_at
          `)
          .eq('status', 'active')
          .gt('departure_at', new Date().toISOString())
          .order('departure_at', { ascending: true });

        if (package_id) query = query.eq('id', package_id);
        if (destination_code) query = query.eq('destination_code', destination_code);
        if (max_price_cents) query = query.lte('price_per_person_cents', max_price_cents);

        const { data: packages, error: pkgErr } = await query;
        if (pkgErr) return json({ error: pkgErr.message }, 500);

        let filtered = packages ?? [];
        if (departure_month) {
          filtered = filtered.filter(p => p.departure_at.startsWith(departure_month));
        }

        const { data: waitlist } = await supabase
          .from('travel_waitlist')
          .select('destination_code')
          .eq('user_id', user.id);
        const waitlistCodes = new Set((waitlist ?? []).map((w: any) => w.destination_code));

        const result = filtered.map((pkg: any) => {
          const seats_remaining = pkg.max_travelers - pkg.travelers_booked;
          return {
            ...pkg,
            seats_remaining,
            urgency: seats_remaining <= 3 ? 'last_few' : seats_remaining <= 8 ? 'filling_up' : 'available',
            on_waitlist: waitlistCodes.has(pkg.destination_code),
          };
        });

        return json({ packages: result, count: result.length });
      }

      // ── sync_ical ───────────────────────────────────────────────────────
      case 'sync_ical': {
        const { property_id } = body;
        const WINDOW_DAYS = 120;
        const allDates = dateRange(WINDOW_DAYS);

        let properties: any[] = [];
        if (property_id) {
          const { data, error } = await supabase
            .from('travel_properties').select('id, name, ical_urls')
            .eq('id', property_id).eq('is_active', true);
          if (error || !data?.length) return json({ error: 'Property not found' }, 404);
          properties = data;
        } else {
          const { data, error } = await supabase
            .from('travel_properties').select('id, name, ical_urls')
            .eq('is_active', true).not('ical_urls', 'eq', '{}');
          if (error) return json({ error: error.message }, 500);
          properties = data ?? [];
        }

        const results: any[] = [];
        for (const prop of properties) {
          const icalUrls: Record<string, string> = prop.ical_urls ?? {};
          if (!Object.keys(icalUrls).length) continue;

          await supabase.from('travel_properties').update({ sync_status: 'syncing' }).eq('id', prop.id);

          let totalUpserted = 0;
          let syncError: string | null = null;

          for (const [roomType, url] of Object.entries(icalUrls)) {
            try {
              const resp = await fetch(url as string);
              if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
              const icalText = await resp.text();
              const bookedDates = parseICalDates(icalText);

              const rows = allDates.map(date => ({
                property_id: prop.id, room_type: roomType, date,
                is_available: !bookedDates.has(date), source: 'ical',
                synced_at: new Date().toISOString(),
              }));

              for (let i = 0; i < rows.length; i += 100) {
                const batch = rows.slice(i, i + 100);
                const { error: upsertErr } = await supabase
                  .from('property_availability')
                  .upsert(batch, { onConflict: 'property_id,room_type,date' });
                if (upsertErr) throw upsertErr;
                totalUpserted += batch.length;
              }
            } catch (e: any) {
              syncError = e.message;
            }
          }

          await supabase.from('travel_properties').update({
            sync_status: syncError ? 'error' : 'synced',
            sync_error: syncError,
            last_sync_at: new Date().toISOString(),
          }).eq('id', prop.id);

          results.push({ property_id: prop.id, name: prop.name, upserted: totalUpserted, error: syncError });
        }

        return json({ synced: results.length, results });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error(`travel/${action} error:`, err);
    return json({ error: err.message || 'Internal server error' }, 500);
  }
});
