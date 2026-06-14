import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { booking_id } = await req.json();
  if (!booking_id) {
    return new Response(JSON.stringify({ error: 'booking_id required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Fetch booking and verify ownership
  const { data: booking, error: fetchErr } = await supabase
    .from('travel_bookings')
    .select(`
      id, user_id, status, total_cents, payment_method, wallet_transaction_id,
      airport_transfer_ride_id,
      travel_packages(departure_at, title, destination_name)
    `)
    .eq('id', booking_id)
    .single();

  if (fetchErr || !booking) {
    return new Response(JSON.stringify({ error: 'Booking not found' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Ownership check — never trust client-supplied user_id
  if (booking.user_id !== user.id) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (booking.status === 'cancelled') {
    return new Response(JSON.stringify({ error: 'Booking already cancelled' }), {
      status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (booking.status === 'completed') {
    return new Response(JSON.stringify({ error: 'Cannot cancel a completed booking' }), {
      status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 24-hour cutoff
  const pkg = (booking as any).travel_packages;
  if (pkg?.departure_at) {
    const hoursUntil = (new Date(pkg.departure_at).getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursUntil < 24) {
      return new Response(JSON.stringify({ error: 'Cannot cancel within 24 hours of departure' }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // Cancel the booking (atomic: only cancels if not already cancelled — prevents double-refund)
  const { data: cancelled, error: cancelErr } = await supabase
    .from('travel_bookings')
    .update({ status: 'cancelled' })
    .eq('id', booking_id)
    .in('status', ['pending', 'confirmed'])
    .select('id')
    .maybeSingle();

  if (cancelErr) {
    return new Response(JSON.stringify({ error: cancelErr.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!cancelled) {
    return new Response(JSON.stringify({ error: 'Booking already cancelled or not in cancellable state' }), {
      status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Refund to wallet if payment was wallet
  let refunded = false;
  if (booking.payment_method === 'wallet' && booking.total_cents > 0) {
    const { error: refundErr } = await supabase.rpc('credit_wallet', {
      p_user_id: user.id,
      p_amount_cents: booking.total_cents,
      p_type: 'travel_package_refund',
      p_description: `Refund for cancelled trip to ${pkg?.destination_name || 'Caribbean'}`,
      p_reference_id: booking_id,
    }).catch(() => ({ error: { message: 'RPC not found, insert directly' } }));

    if (refundErr) {
      // Fallback: direct wallet credit
      const { data: wallet } = await supabase
        .from('wallets')
        .select('id, balance_cents')
        .eq('user_id', user.id)
        .single();

      if (wallet) {
        await supabase
          .from('wallets')
          .update({ balance_cents: wallet.balance_cents + booking.total_cents })
          .eq('id', wallet.id);

        await supabase.from('wallet_transactions').insert({
          user_id: user.id,
          amount: booking.total_cents,
          transaction_type: 'travel_package_refund',
          description: `Refund: ${pkg?.title || 'Caribbean package'} cancelled`,
          status: 'completed',
          reference_id: booking_id,
        });
      }
    }
    refunded = !refundErr;
  }

  // Cancel airport transfer ride if pre-booked
  if ((booking as any).airport_transfer_ride_id) {
    await supabase
      .from('rides')
      .update({ status: 'cancelled' })
      .eq('id', (booking as any).airport_transfer_ride_id)
      .in('status', ['searching', 'scheduled'])
      .catch(() => {});
  }

  // Release capital reserve entry for this booking
  await supabase
    .from('capital_reserve_ledger')
    .update({ status: 'released', notes: `Travel booking ${booking_id} cancelled` })
    .eq('source_booking_id', booking_id)
    .eq('status', 'locked')
    .catch(() => {});

  return new Response(JSON.stringify({
    cancelled: true,
    booking_id,
    refunded,
    refund_amount_cents: refunded ? booking.total_cents : 0,
    message: refunded
      ? `Refund of TTD $${(booking.total_cents / 100).toFixed(2)} will appear in your wallet shortly.`
      : 'Booking cancelled. No refund applicable.',
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
