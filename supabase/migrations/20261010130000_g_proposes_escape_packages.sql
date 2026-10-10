-- ═══════════════════════════════════════════════════════════════════
-- G proposes G-Escape packages; admin approves; approval publishes it.
--
-- Before this, nothing in the product could put an Escape package live
-- without someone typing every field into the admin form. The founder
-- asked for: the system sees the rooms, G builds the package, it lands in
-- the admin approvals inbox, approve -> it's live.
--
--   propose_escape_packages()   daily cron. For every active hotel with a
--       current owner rate quote, on a lane with a real fare source, that
--       has no upcoming package and no pending proposal, files ONE
--       'publish_escape_package' row in g_proposed_actions with the full
--       plan and the projected per-person price. Deterministic -- no LLM
--       decides any number. Departure follows rider demand
--       (escape_lane_interest) when there is any, else ~7 weeks out.
--
--   publish_escape_package(id)  called by g_execute_action's handler after
--       an admin approves. Re-reads the APPROVED proposal itself (never a
--       payload handed in by the caller), creates the flight block
--       (POOLING) + package exactly as the admin form does -- the existing
--       real-cost and sell-price triggers do all pricing -- and REFUSES if
--       the computed price no longer matches what the admin approved
--       (e.g. the hotel quote changed in between). Idempotent on retry.
--       Then tells riders who asked for that island/month.
--
-- Room source today: hotels an admin has listed with a quote (lodging_nodes).
-- When a hotel API (Booking.com partner access) exists, it becomes another
-- way lodging_nodes + quotes get filled; nothing here changes.
--
-- Flight cost: escape_lane_fare_baseline holds ONE-WAY fares, and the
-- flight-block cost trigger uses that number as-is, so a package with a
-- return leg was costing only half its flights. Proposals pass an explicit
-- round-trip seat cost (2 x one-way) so G never under-prices; the
-- breakdown is shown in the proposal for the admin to check.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Registry: publish_escape_package is a real handler ──────────────
INSERT INTO public.g_action_types (action_type, execution_mode, category_default, description, payload_schema, is_enabled)
VALUES (
  'publish_escape_package', 'handler', 'money',
  'Publish a G-Escape package (flight block + package) that G assembled from a quoted hotel. Approving puts it live in the rider Escape store.',
  '{"required": ["lodging_node_id", "destination_code", "departure_time", "expected_price_per_person_cents"]}'::jsonb,
  true
)
ON CONFLICT (action_type) DO UPDATE
  SET execution_mode = EXCLUDED.execution_mode,
      category_default = EXCLUDED.category_default,
      description = EXCLUDED.description,
      payload_schema = EXCLUDED.payload_schema,
      is_enabled = true;

-- ── 2. Proposer ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.propose_escape_packages()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  c_origin_zone  constant text := 'trinidad_west_piarco';  -- matches every existing package
  v_min_group    integer;
  v_filed        integer := 0;
  r              record;
  v_oneway       integer;
  v_seat_cost    integer;
  v_origin_cost  integer;
  v_dest_cost    integer;
  v_lodge_pp     integer;
  v_base_cost    integer;
  v_price        integer;
  v_units        integer;
  v_guests       integer;
  v_month        date;
  v_riders       integer;
  v_seats_wanted integer;
  v_depart       timestamptz;
  v_return       timestamptz;
  v_demand_note  text;
BEGIN
  SELECT min_group_size INTO v_min_group FROM public.carrier_policies WHERE carrier_name = '_default';
  v_min_group := COALESCE(v_min_group, 10);

  FOR r IN
    SELECT ln.*
      FROM public.lodging_nodes ln
     WHERE ln.is_active
       AND ln.quoted_rate_per_night_cents > 0
       -- quote must outlive the 72h approval window
       AND ln.quote_expires_at > now() + interval '3 days'
       AND ln.nights > 0 AND ln.max_guests > 0
       -- no upcoming package already on this hotel
       AND NOT EXISTS (
         SELECT 1 FROM public.escape_packages ep
           JOIN public.flight_blocks fb ON fb.id = ep.flight_block_id
          WHERE ep.lodging_node_id = ln.id
            AND fb.status IN ('DRAFT', 'POOLING', 'CONFIRMED')
            AND fb.departure_time > now())
       -- no proposal for this hotel already waiting
       AND NOT EXISTS (
         SELECT 1 FROM public.g_proposed_actions g
          WHERE g.action_type = 'publish_escape_package'
            AND g.status IN ('pending', 'approved')
            AND g.payload->>'lodging_node_id' = ln.id::text)
  LOOP
    -- Real fare source for the lane, else skip (can't price honestly).
    SELECT fare_cents INTO v_oneway FROM public.escape_lane_fare_baseline
     WHERE origin_code = 'POS' AND destination_code = r.destination_code AND is_active;
    CONTINUE WHEN v_oneway IS NULL OR v_oneway <= 0;

    SELECT payout_cents INTO v_origin_cost FROM public.driver_zone_rates WHERE zone_name = c_origin_zone AND is_active;
    SELECT payout_cents INTO v_dest_cost   FROM public.driver_zone_rates WHERE zone_name = r.location_zone AND is_active;
    CONTINUE WHEN v_origin_cost IS NULL OR v_dest_cost IS NULL;

    -- Rider demand: the most-wanted month for this island that is still far
    -- enough out for airline group terms (30-day hard floor + margin).
    -- Reset first: SELECT INTO leaves the previous hotel's month in place
    -- when this one has no demand rows.
    v_month := NULL;
    SELECT li.travel_month, count(DISTINCT li.rider_id), sum(li.party_size)
      INTO v_month, v_riders, v_seats_wanted
      FROM public.escape_lane_interest li
     WHERE li.destination_code = r.destination_code
       AND li.travel_month >= date_trunc('month', now() + interval '40 days')::date
     GROUP BY li.travel_month
     ORDER BY sum(li.party_size) DESC, li.travel_month
     LIMIT 1;

    IF v_month IS NOT NULL THEN
      -- first Friday of the demanded month, not earlier than 40 days out
      v_depart := (v_month + ((5 - extract(isodow FROM v_month)::int + 7) % 7))::timestamp AT TIME ZONE 'UTC' + interval '14 hours';
      IF v_depart < now() + interval '40 days' THEN
        v_depart := v_depart + interval '7 days';
      END IF;
      v_demand_note := format('%s rider(s) asked for %s in %s (%s seats).', v_riders, r.destination_code, to_char(v_month, 'Mon YYYY'), v_seats_wanted);
    ELSE
      -- first Friday at least 7 weeks out
      v_depart := ((now() + interval '49 days')::date + ((5 - extract(isodow FROM (now() + interval '49 days'))::int + 7) % 7))::timestamp AT TIME ZONE 'UTC' + interval '14 hours';
      v_demand_note := 'No rider has asked for this island yet -- this is supply-led.';
      v_riders := 0;
    END IF;
    v_return := v_depart + make_interval(days => r.nights) + interval '4 hours';

    -- Enough units of the property to reach the airline's minimum group,
    -- each unit priced full (lodging cost/person assumes a full unit).
    v_units  := CEIL(v_min_group::numeric / r.max_guests);
    v_guests := v_units * r.max_guests;

    v_seat_cost := v_oneway * 2;  -- round trip
    v_lodge_pp  := ROUND((r.quoted_rate_per_night_cents * r.nights)::numeric / r.max_guests);
    v_base_cost := v_seat_cost + v_lodge_pp + v_origin_cost + v_dest_cost;
    v_price     := public.calculate_escape_sell_price(v_base_cost, 'TT', false);

    INSERT INTO public.g_proposed_actions (department, action_type, title, reasoning, payload, category, amount_cents)
    VALUES (
      'escape',
      'publish_escape_package',
      format('Publish Escape: %s, %s nights from %s -- TTD %s/person',
             r.name, r.nights, to_char(v_depart AT TIME ZONE 'America/Port_of_Spain', 'Dy DD Mon'),
             to_char(v_price / 100.0, 'FM999,999')),
      format(
        E'%s\n\nThe plan: %s guests (%s unit(s) of %s, %s guests each), flying POS -> %s on %s, back %s. The flight goes live for pooling; it only books when %s seats fill (the airline group minimum).\n\nCost per person: flights TTD %s (round trip, from the saved one-way fare TTD %s x 2), hotel TTD %s (owner quote TTD %s/night x %s nights / %s guests), drivers TTD %s (Trinidad side) + TTD %s (island side). Total cost TTD %s, sells at TTD %s, platform margin TTD %s.\n\nBefore approving: confirm the owner has %s unit(s) free for those dates. The hotel quote expires %s.',
        v_demand_note,
        v_guests, v_units, r.name, r.max_guests,
        r.destination_code, to_char(v_depart AT TIME ZONE 'America/Port_of_Spain', 'Dy DD Mon YYYY'),
        to_char(v_return AT TIME ZONE 'America/Port_of_Spain', 'Dy DD Mon'),
        v_min_group,
        to_char(v_seat_cost / 100.0, 'FM999,999'), to_char(v_oneway / 100.0, 'FM999,999'),
        to_char(v_lodge_pp / 100.0, 'FM999,999'), to_char(r.quoted_rate_per_night_cents / 100.0, 'FM999,999'), r.nights, r.max_guests,
        to_char(v_origin_cost / 100.0, 'FM999,999'), to_char(v_dest_cost / 100.0, 'FM999,999'),
        to_char(v_base_cost / 100.0, 'FM999,999'), to_char(v_price / 100.0, 'FM999,999'), to_char((v_price - v_base_cost) / 100.0, 'FM999,999'),
        v_units, to_char(r.quote_expires_at AT TIME ZONE 'America/Port_of_Spain', 'DD Mon YYYY')
      ),
      jsonb_build_object(
        'lodging_node_id', r.id,
        'package_name', r.name || ' Escape',
        'origin_code', 'POS',
        'destination_code', r.destination_code,
        'destination_name', CASE r.destination_code
            WHEN 'TAB' THEN 'Tobago' WHEN 'BGI' THEN 'Barbados' WHEN 'GND' THEN 'Grenada'
            WHEN 'ANU' THEN 'Antigua' WHEN 'SKB' THEN 'St. Kitts' WHEN 'SLU' THEN 'St. Lucia'
            ELSE r.destination_code END,
        'departure_time', v_depart,
        'return_time', v_return,
        'total_capacity_seats', v_guests,
        'tipping_point_seats', v_min_group,
        'max_total_guests', v_guests,
        'flight_cost_per_seat_cents', v_seat_cost,
        'driver_origin_zone', c_origin_zone,
        'driver_destination_zone', r.location_zone,
        'expected_price_per_person_cents', v_price,
        'demand_riders', v_riders
      ),
      'money',
      v_price
    );
    v_filed := v_filed + 1;
  END LOOP;

  RETURN v_filed;
END;
$function$;

REVOKE ALL ON FUNCTION public.propose_escape_packages() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.propose_escape_packages() TO service_role;

-- ── 3. Publisher (runs on approval) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.publish_escape_package(p_proposal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_p        public.g_proposed_actions;
  pl         jsonb;
  v_marker   text;
  v_block_id uuid;
  v_pkg      record;
  v_expected integer;
  v_notified integer := 0;
  li         record;
BEGIN
  SELECT * INTO v_p FROM public.g_proposed_actions WHERE id = p_proposal_id FOR UPDATE;
  IF v_p.id IS NULL OR v_p.action_type <> 'publish_escape_package' THEN
    RETURN jsonb_build_object('success', false, 'error', 'proposal not found');
  END IF;
  IF v_p.status <> 'approved' THEN
    RETURN jsonb_build_object('success', false, 'error', 'proposal is ' || v_p.status || ', not approved');
  END IF;
  pl := v_p.payload;
  v_expected := (pl->>'expected_price_per_person_cents')::int;
  v_marker := 'g_proposal:' || v_p.id;

  -- Idempotent: a retried execution returns what the first one created.
  SELECT ep.id, ep.price_per_person_cents, fb.id AS block_id INTO v_pkg
    FROM public.flight_blocks fb JOIN public.escape_packages ep ON ep.flight_block_id = fb.id
   WHERE fb.notes = v_marker;
  IF v_pkg.id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_published', true,
      'escape_package_id', v_pkg.id, 'flight_block_id', v_pkg.block_id, 'price_per_person_cents', v_pkg.price_per_person_cents);
  END IF;

  -- Same shape the admin form inserts; triggers enforce the 30-day floor,
  -- the hotel quote, and compute every cost and the sell price.
  INSERT INTO public.flight_blocks (origin_code, destination_code, destination_name, departure_time, return_time,
                                    total_capacity_seats, allocated_seats, tipping_point_seats, status,
                                    flight_cost_per_seat_cents, notes, created_by)
  VALUES (pl->>'origin_code', pl->>'destination_code', pl->>'destination_name',
          (pl->>'departure_time')::timestamptz, (pl->>'return_time')::timestamptz,
          (pl->>'total_capacity_seats')::int, 0, (pl->>'tipping_point_seats')::int, 'POOLING',
          (pl->>'flight_cost_per_seat_cents')::int, v_marker, v_p.decided_by)
  RETURNING id INTO v_block_id;

  INSERT INTO public.escape_packages (flight_block_id, lodging_node_id, package_name, driver_origin_zone,
                                      driver_destination_zone, max_total_guests, is_active, created_by)
  VALUES (v_block_id, (pl->>'lodging_node_id')::uuid, pl->>'package_name', pl->>'driver_origin_zone',
          pl->>'driver_destination_zone', (pl->>'max_total_guests')::int, true, v_p.decided_by)
  RETURNING id, price_per_person_cents INTO v_pkg;

  -- The admin approved a specific price. If anything moved since (quote,
  -- fares, zone rates, pricing rules), don't publish a different number.
  IF v_pkg.price_per_person_cents IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'Price changed since this was proposed (approved TTD %, now TTD %). Not published -- G will propose again with the new price.',
      round(v_expected / 100.0), round(v_pkg.price_per_person_cents / 100.0);
  END IF;

  -- Close the loop with riders who asked for this island that month.
  FOR li IN
    SELECT DISTINCT rider_id FROM public.escape_lane_interest
     WHERE destination_code = pl->>'destination_code'
       AND travel_month = date_trunc('month', (pl->>'departure_time')::timestamptz)::date
  LOOP
    PERFORM public.notify_user(li.rider_id, 'escape',
      (pl->>'destination_name') || ' is open',
      'The escape you asked for is live -- ' || (pl->>'package_name') || ', TTD ' || to_char(v_expected / 100.0, 'FM999,999') || '/person. Join the pool in Escape.');
    v_notified := v_notified + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'escape_package_id', v_pkg.id, 'flight_block_id', v_block_id,
                            'price_per_person_cents', v_pkg.price_per_person_cents, 'riders_notified', v_notified);
END;
$function$;

REVOKE ALL ON FUNCTION public.publish_escape_package(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_escape_package(uuid) TO service_role;

-- ── 4. Daily run, 13:00 UTC = 9am Trinidad ──────────────────────────────
-- Acts only on current state (quoted hotels without an upcoming package),
-- never on historical rows, so no launch cutoff is needed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'propose-escape-packages') THEN
    PERFORM cron.unschedule('propose-escape-packages');
  END IF;
END $$;
SELECT cron.schedule('propose-escape-packages', '0 13 * * *', $job$SELECT public.propose_escape_packages()$job$);
