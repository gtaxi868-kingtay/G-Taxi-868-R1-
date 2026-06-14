import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

// Stripe webhook for G-Escape payment confirmation.
// Listens for payment_intent.succeeded on intents created by book_escape
// (identified by metadata.source = 'g_escape_booking').
//
// On success: transitions package_reservations.status ACTIVE_HOLD → CAPTURED.
// The seat is now fully committed. Stripe will capture the charge when
// check_flight_tipping_points() CONFIRMs the block, or void if CANCELLED.
//
// Separate from the main stripe_webhook to keep escape business logic
// isolated — the ride payment webhook is already complex.
//
// Raw body MUST be read before any JSON parsing (Stripe signature verification).

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
      },
    });
  }

  // Raw body FIRST — Stripe signature verification requires the unmodified bytes
  const rawBody = await req.text();
  const sig = req.headers.get('stripe-signature');

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

  if (!stripeKey || !webhookSecret) {
    console.error('confirm_escape_payment: Stripe secrets not configured');
    return json({ error: 'Payment processing not configured' }, 503);
  }

  const stripe = new Stripe(stripeKey, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, sig ?? '', webhookSecret);
  } catch (err: any) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return json({ error: 'Invalid signature' }, 400);
  }

  // Only handle events relevant to G-Escape
  const relevantEvents = [
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'payment_intent.canceled',
  ];
  if (!relevantEvents.includes(event.type)) {
    return json({ received: true, skipped: true });
  }

  const intent = event.data.object as Stripe.PaymentIntent;

  // Only process intents from G-Escape bookings
  if (intent.metadata?.source !== 'g_escape_booking') {
    return json({ received: true, skipped: true });
  }

  const reservationId = intent.metadata?.reservation_id;
  if (!reservationId) {
    console.error('G-Escape webhook: no reservation_id in intent metadata', intent.id);
    return json({ error: 'No reservation_id in metadata' }, 400);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  if (event.type === 'payment_intent.succeeded') {
    // Payment method confirmed — transition to CAPTURED
    const { error } = await supabase
      .from('package_reservations')
      .update({
        status: 'CAPTURED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', reservationId)
      .eq('status', 'ACTIVE_HOLD');

    if (error) {
      console.error('confirm_escape_payment: failed to update reservation', reservationId, error);
      return json({ error: 'Failed to update reservation status' }, 500);
    }

    // Fetch rider's push token for confirmation notification
    const { data: res } = await supabase
      .from('package_reservations')
      .select('rider_id, booking_ref, escape_packages ( package_name, flight_blocks ( destination_name, tipping_point_seats, allocated_seats ) )')
      .eq('id', reservationId)
      .single();

    if (res?.rider_id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('push_token')
        .eq('id', res.rider_id)
        .single();

      if (profile?.push_token) {
        const pkg = Array.isArray(res.escape_packages) ? res.escape_packages[0] : res.escape_packages;
        const fb = pkg?.flight_blocks
          ? (Array.isArray(pkg.flight_blocks) ? pkg.flight_blocks[0] : pkg.flight_blocks)
          : null;
        const seatsLeft = fb ? fb.tipping_point_seats - fb.allocated_seats : null;

        await supabase.functions.invoke('send_push_notification', {
          body: {
            token: profile.push_token,
            title: `Seat secured! 🎉`,
            body: seatsLeft != null && seatsLeft > 0
              ? `You're in the pool for ${pkg?.package_name ?? 'G Escape'}. ${seatsLeft} more seat${seatsLeft !== 1 ? 's' : ''} needed to lock the flight.`
              : `You're in! The flight pool just reached its tipping point. Your escape is confirmed.`,
          },
        }).catch(() => {});
      }
    }

    console.log('confirm_escape_payment: ACTIVE_HOLD → CAPTURED', reservationId);
    return json({ received: true, reservation_id: reservationId, status: 'CAPTURED' });
  }

  if (event.type === 'payment_intent.payment_failed') {
    // Payment method failed — release the seat hold so others can book
    await supabase.rpc('release_single_reservation', { p_reservation_id: reservationId }).catch(() => {});
    console.log('confirm_escape_payment: payment failed, seat released', reservationId);
    return json({ received: true, reservation_id: reservationId, status: 'RELEASED' });
  }

  if (event.type === 'payment_intent.canceled') {
    // Intent cancelled (e.g. by our own release_single_reservation on hold expiry)
    await supabase
      .from('package_reservations')
      .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
      .eq('id', reservationId)
      .in('status', ['ACTIVE_HOLD']);
    return json({ received: true, reservation_id: reservationId, status: 'CANCELLED' });
  }

  return json({ received: true });
});
