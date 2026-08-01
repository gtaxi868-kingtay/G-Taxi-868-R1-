import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Returns the driver's full lease situation in one call.
// The LeaseScreen branches on named status codes without additional fetches.

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

  const authHeader = req.headers.get('Authorization');
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader ?? '' } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader?.replace('Bearer ', '')
  );
  if (authError || !user) return json({ error: 'Unauthorized' }, 401);

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const { data: driver } = await supabaseAdmin
    .from('drivers')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!driver) return json({ error: 'Driver profile not found' }, 404);

  const { data: eligibility } = await supabaseAdmin
    .from('driver_lease_eligibility')
    .select('*')
    .eq('driver_id', driver.id)
    .maybeSingle();

  if (!eligibility) {
    await supabaseAdmin
      .rpc('refresh_driver_lease_eligibility', { p_driver_id: driver.id })
      .then((__r) => __r, () => {});
  }

  const activeDays = eligibility?.active_days_count ?? 0;
  const qualified = eligibility?.qualified ?? false;

  if (!qualified) {
    return json({
      success: true,
      data: {
        status: 'NOT_ELIGIBLE_YET',
        active_days_count: activeDays,
        days_needed: Math.max(0, 90 - activeDays),
        progress_pct: Math.min(100, Math.round((activeDays / 90) * 100)),
        qualified: false,
        lease: null,
        dispute: null,
        installment_summary: null,
      },
    });
  }

  const { data: lease } = await supabaseAdmin
    .from('fleet_leases')
    .select(`id, status, per_ride_installment_cents, dispute_open,
      suspension_reason, reserve_funded, start_date, end_date, daily_rate_cents,
      fleet_vehicles ( make, model, year, license_plate, ownership_type )`)
    .eq('driver_id', driver.id)
    .in('status', ['active', 'suspended', 'ended'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lease) {
    return json({
      success: true,
      data: {
        status: 'NO_ACTIVE_LEASE',
        active_days_count: activeDays,
        qualified: true,
        qualified_at: eligibility?.qualified_at,
        lease: null,
        dispute: null,
        installment_summary: null,
      },
    });
  }

  if (lease.status === 'ended') {
    return json({
      success: true,
      data: {
        status: 'LEASE_ENDED',
        active_days_count: activeDays,
        qualified: true,
        lease: { id: lease.id, vehicle: lease.fleet_vehicles, end_date: lease.end_date },
        dispute: null,
        installment_summary: null,
      },
    });
  }

  const { data: dispute } = await supabaseAdmin
    .from('lease_disputes')
    .select('id, reason, disputed_at, amount_cents, status')
    .eq('lease_id', lease.id)
    .eq('status', 'open')
    .maybeSingle();

  if (lease.dispute_open && dispute) {
    return json({
      success: true,
      data: {
        status: 'DISPUTE_OPEN',
        active_days_count: activeDays,
        qualified: true,
        lease: { id: lease.id, vehicle: lease.fleet_vehicles },
        dispute: { id: dispute.id, reason: dispute.reason, disputed_at: dispute.disputed_at, amount_cents: dispute.amount_cents },
        installment_summary: null,
      },
    });
  }

  if (lease.status === 'suspended') {
    return json({
      success: true,
      data: {
        status: 'LEASE_SUSPENDED',
        active_days_count: activeDays,
        qualified: true,
        lease: { id: lease.id, vehicle: lease.fleet_vehicles, suspension_reason: lease.suspension_reason },
        dispute: null,
        installment_summary: null,
      },
    });
  }

  const { count: rideCount } = await supabaseAdmin
    .from('lease_payments')
    .select('id', { count: 'exact', head: true })
    .eq('lease_id', lease.id)
    .eq('status', 'paid');

  const { data: totalPaid } = await supabaseAdmin
    .from('lease_payments')
    .select('amount_cents')
    .eq('lease_id', lease.id)
    .eq('status', 'paid');

  const totalPaidCents = (totalPaid ?? []).reduce((s: number, p: any) => s + (p.amount_cents ?? 0), 0);

  return json({
    success: true,
    data: {
      status: 'ACTIVE',
      active_days_count: activeDays,
      qualified: true,
      lease: {
        id: lease.id,
        vehicle: lease.fleet_vehicles,
        start_date: lease.start_date,
        end_date: lease.end_date,
        per_ride_installment_cents: lease.per_ride_installment_cents ?? 5000,
        reserve_funded: lease.reserve_funded,
        daily_rate_cents: lease.daily_rate_cents,
      },
      dispute: null,
      installment_summary: {
        rides_contributed: rideCount ?? 0,
        total_paid_cents: totalPaidCents,
      },
    },
  });
});
