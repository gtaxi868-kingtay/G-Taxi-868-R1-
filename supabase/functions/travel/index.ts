import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { checkVerticalAccess } from '../_shared/verticalGate.ts';
import { getCorsHeaders } from '../_shared/cors.ts'

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


serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

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

        const access = await checkVerticalAccess(supabase, user.id, 'g_escape');
        if (!access.allowed) {
          return json({ error: access.reason }, 403);
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
          await supabase.rpc('release_single_reservation', { p_reservation_id: reservationId }).then((__r) => __r, () => {});
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
          await supabase.rpc('record_rider_activity', {
            p_rider_id: user.id, p_event_type: 'escape_booking',
            p_amount_cents: totalCents, p_ride_id: null,
            p_metadata: { reservation_id: reservationId, escape_package_id, payment_method: 'wallet' },
          }).then(null, () => {});
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

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error(`travel/${action} error:`, err);
    return json({ error: err.message || 'Internal server error' }, 500);
  }
});
