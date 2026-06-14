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

  const url = new URL(req.url);
  const destination_code = url.searchParams.get('destination_code') || undefined;
  const departure_month = url.searchParams.get('departure_month') || undefined;
  const max_price_cents = url.searchParams.get('max_price_cents')
    ? parseInt(url.searchParams.get('max_price_cents')!)
    : undefined;

  // Also accept body params for POST
  let bodyParams: Record<string, any> = {};
  if (req.method === 'POST') {
    bodyParams = await req.json().catch(() => ({}));
  }
  const destFilter = destination_code || bodyParams.destination_code;
  const monthFilter = departure_month || bodyParams.departure_month;
  const maxPrice = max_price_cents ?? bodyParams.max_price_cents;

  let query = supabase
    .from('travel_packages')
    .select(`
      id, title, destination_code, destination_name, origin_code,
      cover_image_url, property_id, flight_inventory_id,
      flight_info, hotel_info,
      price_per_person_cents, max_travelers, travelers_booked,
      includes_airport_transfer, status, departure_at, expires_at,
      created_at
    `)
    .eq('status', 'active')
    .gt('departure_at', new Date().toISOString())
    .order('departure_at', { ascending: true });

  if (destFilter) query = query.eq('destination_code', destFilter);
  if (maxPrice) query = query.lte('price_per_person_cents', maxPrice);

  const { data: packages, error: pkgErr } = await query;
  if (pkgErr) {
    return new Response(JSON.stringify({ error: pkgErr.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Filter by departure month if provided (YYYY-MM format)
  let filtered = packages ?? [];
  if (monthFilter) {
    filtered = filtered.filter(p => p.departure_at.startsWith(monthFilter));
  }

  // Fetch user's waitlist to overlay on_waitlist flag
  const { data: waitlist } = await supabase
    .from('travel_waitlist')
    .select('destination_code')
    .eq('user_id', user.id);
  const waitlistCodes = new Set((waitlist ?? []).map((w: any) => w.destination_code));

  // Strip wholesale_cost_cents — NEVER expose margin data to riders
  const result = filtered.map(pkg => {
    const seats_remaining = pkg.max_travelers - pkg.travelers_booked;
    return {
      ...pkg,
      // wholesale_cost_cents intentionally absent
      seats_remaining,
      urgency: seats_remaining <= 3 ? 'last_few' : seats_remaining <= 8 ? 'filling_up' : 'available',
      on_waitlist: waitlistCodes.has(pkg.destination_code),
    };
  });

  return new Response(JSON.stringify({ packages: result, count: result.length }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
