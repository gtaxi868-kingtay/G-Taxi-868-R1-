-- Seed 3 G-Escape packages: Tobago, Barbados, Grenada
-- Each package needs: a flight_block + lodging_node + escape_package row
-- Prices in TTD cents. All departures set to next Saturday for freshness.

DO $$
DECLARE
  next_sat DATE;
  fb_tobago UUID;
  fb_barbados UUID;
  fb_grenada UUID;
  ln_tobago UUID;
  ln_barbados UUID;
  ln_grenada UUID;
BEGIN
  next_sat := date_trunc('week', CURRENT_DATE + INTERVAL '1 day') + INTERVAL '5 days';

  -- ── Flight blocks ────────────────────────────────────────────────────────

  INSERT INTO public.flight_blocks (
    origin_code, destination_code, destination_name, departure_time, return_time,
    aircraft_type, total_capacity_seats, allocated_seats, tipping_point_seats,
    flight_cost_per_seat_cents, status, cancel_deadline
  ) VALUES (
    'POS', 'TAB', 'Tobago', next_sat + INTERVAL '7 days' + TIME '07:00',
    next_sat + INTERVAL '10 days' + TIME '14:00',
    'CAL ATR 72-600', 68, 0, 35, 120000,
    'POOLING', next_sat + INTERVAL '4 days' + TIME '23:59'
  ) RETURNING id INTO fb_tobago;

  INSERT INTO public.flight_blocks (
    origin_code, destination_code, destination_name, departure_time, return_time,
    aircraft_type, total_capacity_seats, allocated_seats, tipping_point_seats,
    flight_cost_per_seat_cents, status, cancel_deadline
  ) VALUES (
    'POS', 'BGI', 'Barbados', next_sat + INTERVAL '14 days' + TIME '06:00',
    next_sat + INTERVAL '18 days' + TIME '15:00',
    'CAL Boeing 737-800', 150, 0, 50, 180000,
    'POOLING', next_sat + INTERVAL '11 days' + TIME '23:59'
  ) RETURNING id INTO fb_barbados;

  INSERT INTO public.flight_blocks (
    origin_code, destination_code, destination_name, departure_time, return_time,
    aircraft_type, total_capacity_seats, allocated_seats, tipping_point_seats,
    flight_cost_per_seat_cents, status, cancel_deadline
  ) VALUES (
    'POS', 'GND', 'Grenada', next_sat + INTERVAL '21 days' + TIME '08:00',
    next_sat + INTERVAL '23 days' + TIME '13:00',
    'CAL ATR 72-600', 68, 0, 25, 160000,
    'POOLING', next_sat + INTERVAL '18 days' + TIME '23:59'
  ) RETURNING id INTO fb_grenada;

  -- ── Lodging nodes ────────────────────────────────────────────────────────

  INSERT INTO public.lodging_nodes (
    name, destination_code, location_zone, min_guests, max_guests, nights,
    base_price_per_night_cents, cover_image_url, description, amenities
  ) VALUES (
    'Store Bay Holiday Resort', 'TAB', 'tobago_airport_crown', 1, 4, 2,
    60000,
    'https://images.unsplash.com/photo-1566073771259-6a8506099945',
    'Beachfront resort on Store Bay with pool, restaurant, and direct beach access.',
    ARRAY['Pool', 'Restaurant', 'Beach Access', 'WiFi', 'AC']
  ) RETURNING id INTO ln_tobago;

  INSERT INTO public.lodging_nodes (
    name, destination_code, location_zone, min_guests, max_guests, nights,
    base_price_per_night_cents, cover_image_url, description, amenities
  ) VALUES (
    'St Lawrence Beach House', 'BGI', 'barbados_grantley_south', 1, 6, 3,
    55000,
    'https://images.unsplash.com/photo-1582719508461-905c673771fd',
    'South coast beach house walking distance to St Lawrence Gap restaurants and nightlife.',
    ARRAY['Pool', 'AC', 'WiFi', 'Kitchen', 'Parking']
  ) RETURNING id INTO ln_barbados;

  INSERT INTO public.lodging_nodes (
    name, destination_code, location_zone, min_guests, max_guests, nights,
    base_price_per_night_cents, cover_image_url, description, amenities
  ) VALUES (
    'Grand Anse Villa', 'GND', 'grenada_local', 1, 4, 2,
    50000,
    'https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9',
    'Modern villa overlooking Grand Anse beach with infinity pool and spice garden.',
    ARRAY['Infinity Pool', 'AC', 'WiFi', 'Kitchen', 'Garden', 'Housekeeping']
  ) RETURNING id INTO ln_grenada;

  -- ── Escape packages ──────────────────────────────────────────────────────
  -- price = flight_cost + lodging_cost + driver_origin + driver_destination +
  --         platform_margin + loyalty_rebate
  -- margin_positive check enforces price > sum of all costs

  INSERT INTO public.escape_packages (
    flight_block_id, lodging_node_id, package_name, tagline, cover_image_url,
    price_per_person_cents, flight_cost_per_person_cents, lodging_cost_per_person_cents,
    driver_origin_zone, driver_origin_cost_cents, driver_destination_zone, driver_destination_cost_cents,
    platform_margin_cents, loyalty_rebate_cents, is_active
  ) VALUES (
    fb_tobago, ln_tobago,
    'Tobago Beach Escape',
    '2 nights at Store Bay — your weekend starts here',
    'https://images.unsplash.com/photo-1566073771259-6a8506099945',
    350000, 120000, 120000,
    'trinidad_west_piarco', 8000, 'tobago_airport_crown', 3000,
    90000, 9000, TRUE
  );

  INSERT INTO public.escape_packages (
    flight_block_id, lodging_node_id, package_name, tagline, cover_image_url,
    price_per_person_cents, flight_cost_per_person_cents, lodging_cost_per_person_cents,
    driver_origin_zone, driver_origin_cost_cents, driver_destination_zone, driver_destination_cost_cents,
    platform_margin_cents, loyalty_rebate_cents, is_active
  ) VALUES (
    fb_barbados, ln_barbados,
    'Barbados Sun & Sand',
    '3 nights on the South Coast — rum, sun, and sea',
    'https://images.unsplash.com/photo-1582719508461-905c673771fd',
    550000, 180000, 165000,
    'trinidad_west_piarco', 8000, 'barbados_grantley_south', 4200,
    172800, 20000, TRUE
  );

  INSERT INTO public.escape_packages (
    flight_block_id, lodging_node_id, package_name, tagline, cover_image_url,
    price_per_person_cents, flight_cost_per_person_cents, lodging_cost_per_person_cents,
    driver_origin_zone, driver_origin_cost_cents, driver_destination_zone, driver_destination_cost_cents,
    platform_margin_cents, loyalty_rebate_cents, is_active
  ) VALUES (
    fb_grenada, ln_grenada,
    'Grenada Spice Escape',
    '2 nights at Grand Anse — spice, chocolate, and the Caribbean',
    'https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9',
    420000, 160000, 100000,
    'trinidad_west_piarco', 8000, 'grenada_local', 3500,
    138500, 10000, TRUE
  );
END $$;
