import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

// G-Escape booking endpoint.
// Step 1: secure_escape_booking() locks seats with FOR UPDATE (10-min hold).
// Step 2a (Stripe): creates PaymentIntent with capture_method='manual' — pre-auth only.
//   Capture fires ONLY when check_flight_tipping_points() CONFIRMs the flight block.
// Step 2b (wallet): capture_escape_wallet_payment() does SELECT FOR UPDATE on wallet.
// On any downstream failure: release_single_reservation() returns seats immediately.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // Identity always resolves from JWT — never from request body
  const authHeader = req.headers.get('Authorization');
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader?.replace('Bearer ', '') ?? ''
  );
  if (authError || !user) return json({ error: 'Unauthorized' }, 401);

  const {
    escape_package_id,
    guest_count = 1,
    payment_method = 'stripe',
    pickup_address,
    pickup_lat,
    pickup_lng,
    passenger_names = [],
    special_requests,
  } = await req.json();

  if (!escape_package_id) return json({ error: 'escape_package_id required' }, 400);
  if (!['stripe', 'wallet'].includes(payment_method)) {
    return json({ error: 'payment_method must be stripe or wallet' }, 400);
  }

  // Idempotency: if rider already has an unexpired hold on this package, return it
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

  // ── Step 1: Atomic seat hold ──────────────────────────────────────────────
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
                 : hold?.message?.includes('Guest count') ? 422
                 : 400;
    return json({
      error: hold?.message || 'Hold failed',
      seats_remaining: hold?.seats_remaining ?? null,
      requires_verification: hold?.requires_verification ?? false,
    }, status);
  }

  const reservationId: string  = hold.reservation_id;
  const totalCents: number     = hold.total_price_cents;
  const holdExpiresAt: string  = hold.hold_expires_at;
  const seatsRemaining: number = hold.seats_remaining;
  const requiresVerification: boolean = hold.requires_verification;

  const { data: resRow } = await supabase
    .from('package_reservations')
    .select('booking_ref')
    .eq('id', reservationId)
    .single();
  const bookingRef: string | null = resRow?.booking_ref ?? null;

  // Rollback helper: called on any downstream failure after seats are locked
  const releaseHold = async () => {
    await supabase.rpc('release_single_reservation', { p_reservation_id: reservationId }).catch(() => {});
  };

  // ── Step 2a: Wallet payment ───────────────────────────────────────────────
  if (payment_method === 'wallet') {
    const { data: captureRows, error: captureError } = await supabase.rpc(
      'capture_escape_wallet_payment',
      { p_reservation_id: reservationId, p_rider_id: user.id }
    );

    const capture = Array.isArray(captureRows) ? captureRows[0] : captureRows;

    if (captureError || !capture?.success) {
      await releaseHold();
      return json({
        error: capture?.message || captureError?.message || 'Insufficient wallet balance',
      }, 402);
    }

    return json({
      reservation_id: reservationId,
      booking_ref: bookingRef,
      total_price_cents: totalCents,
      hold_expires_at: holdExpiresAt,
      seats_remaining: seatsRemaining,
      requires_verification: requiresVerification,
      payment_method: 'wallet',
      status: 'CAPTURED',
    });
  }

  // ── Step 2b: Stripe pre-auth ──────────────────────────────────────────────
  // capture_method: 'manual' — card is reserved but never charged automatically.
  // check_flight_tipping_points() captures payment intents when the block CONFIRMs.
  // If the block CANCELS, all uncaptured intents are automatically voided by Stripe.
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
        reservation_id: reservationId,
        booking_ref: bookingRef ?? '',
        escape_package_id,
        rider_id: user.id,
        guest_count: String(guest_count),
        hold_expires_at: holdExpiresAt,
        source: 'g_escape_booking',
      },
    });

    clientSecret    = intent.client_secret!;
    paymentIntentId = intent.id;
  } catch (err: any) {
    console.error('Stripe PaymentIntent error:', err.message);
    await releaseHold();
    return json({ error: err.message || 'Payment setup failed' }, 502);
  }

  // Store PaymentIntent ID so the capture step (stripe_webhook + tipping point cron) can find it
  await supabase
    .from('package_reservations')
    .update({ stripe_payment_intent_id: paymentIntentId, updated_at: new Date().toISOString() })
    .eq('id', reservationId);

  return json({
    reservation_id: reservationId,
    booking_ref: bookingRef,
    total_price_cents: totalCents,
    hold_expires_at: holdExpiresAt,
    seats_remaining: seatsRemaining,
    requires_verification: requiresVerification,
    payment_method: 'stripe',
    status: 'ACTIVE_HOLD',
    // Frontend passes this to Stripe.presentPaymentSheet() — never log or store client-side
    client_secret: clientSecret,
  });
});
