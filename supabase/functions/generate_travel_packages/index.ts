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

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (profile?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const now = new Date();
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + 90);

  const { data: flights, error: flightErr } = await supabase
    .from('flight_inventory')
    .select('*')
    .gte('departure_at', now.toISOString())
    .lte('departure_at', windowEnd.toISOString())
    .eq('status', 'available');

  if (flightErr) {
    return new Response(JSON.stringify({ error: flightErr.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: vsRow } = await supabase
    .from('vertical_settings')
    .select('config')
    .eq('vertical_name', 'caribbean_travel')
    .single();
  const config = vsRow?.config ?? {};

  const generated: any[] = [];
  const MARGIN_MULTIPLIER = 1.25;

  for (const flight of (flights ?? [])) {
    const seatsAvailable = flight.seats_total - flight.seats_reserved;
    if (seatsAvailable < 4) continue;

    const dest = flight.destination_code.toLowerCase();
    const ceilingKey = `${dest}_hotel_max_per_night_usd`;
    const ceilingUsd = config[ceilingKey] ?? 120;
    const ceilingCents = ceilingUsd * 100 * 6.79;

    const departureDate = new Date(flight.departure_at);
    const returnDate = flight.return_departure_at ? new Date(flight.return_departure_at) : null;
    const nights = returnDate
      ? Math.round((returnDate.getTime() - departureDate.getTime()) / (1000 * 60 * 60 * 24))
      : 2;

    const depDateStr = departureDate.toISOString().slice(0, 10);
    const endDate = new Date(departureDate);
    endDate.setDate(endDate.getDate() + nights);
    const endDateStr = endDate.toISOString().slice(0, 10);

    const { data: properties } = await supabase
      .from('travel_properties')
      .select('id, name, merchant_id, room_types, stars, destination_code')
      .eq('destination_code', flight.destination_code)
      .eq('is_active', true);

    for (const prop of (properties ?? [])) {
      const roomTypes: any[] = prop.room_types ?? [];
      for (const room of roomTypes) {
        if ((room.base_rate_cents ?? 0) > ceilingCents) continue;

        const { data: availRows } = await supabase
          .from('property_availability')
          .select('date, is_available, rate_cents')
          .eq('property_id', prop.id)
          .eq('room_type', room.type)
          .gte('date', depDateStr)
          .lt('date', endDateStr)
          .eq('is_available', true);

        if (!availRows || availRows.length < nights) continue;

        const hotelWholesale = availRows.reduce((s: number, r: any) => s + (r.rate_cents ?? room.base_rate_cents ?? 0), 0);
        if (hotelWholesale > ceilingCents * nights) continue;

        const totalWholesale = flight.wholesale_price_cents + hotelWholesale;
        const suggestedRetail = Math.round(totalWholesale * MARGIN_MULTIPLIER);

        const title = `${flight.destination_code} ${nights}N — ${prop.name}`;

        const { data: existing } = await supabase
          .from('travel_packages')
          .select('id')
          .eq('flight_inventory_id', flight.id)
          .eq('property_id', prop.id)
          .maybeSingle();

        if (existing) continue;

        const { data: pkg, error: pkgErr } = await supabase
          .from('travel_packages')
          .insert({
            title,
            destination_code: flight.destination_code,
            destination_name: flight.destination_code,
            origin_code: flight.origin_code,
            property_id: prop.id,
            flight_inventory_id: flight.id,
            flight_info: {
              airline: 'Caribbean Airlines',
              flight_number: flight.flight_number,
              cabin: flight.cabin_class,
              departure_at: flight.departure_at,
              return_departure_at: flight.return_departure_at,
            },
            hotel_info: {
              name: prop.name,
              nights,
              room_type: room.type,
              stars: prop.stars,
              check_in: depDateStr,
              check_out: endDateStr,
            },
            price_per_person_cents: suggestedRetail,
            wholesale_cost_cents: totalWholesale,
            max_travelers: Math.min(seatsAvailable, 20),
            includes_airport_transfer: true,
            auto_generated: true,
            status: 'draft',
            departure_at: flight.departure_at,
            created_by: user.id,
          })
          .select('id, title')
          .single();

        if (!pkgErr && pkg) generated.push(pkg);
      }
    }
  }

  return new Response(JSON.stringify({ generated_count: generated.length, packages: generated }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
