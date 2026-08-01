-- ═══════════════════════════════════════════════════════════════════
-- G-ESCAPE HOTEL NOTIFICATION + LODGING COORDINATES (2026-07-16)
--
-- Owner-requested: hotels (like airlines) must be notified when a group
-- booking confirms, not just credited in the internal financial ledger.
-- check_flight_tipping_points already wrote 'villa_merchant' into
-- transit_financial_ledger at confirmation -- that's bookkeeping, not a
-- real notification. Now also pings the hotel's owner account via
-- notify_user, once per property per confirmation run. Also notifies
-- the rider their trip is confirmed, which did not happen at this step.
--
-- Added lat/lng to lodging_nodes -- did not exist at all. Groundwork for
-- real driver-ride dispatch on the two GROUND_TRANSIT itinerary legs
-- (airport<->hotel), which is NOT built yet -- the legs are created as
-- scheduled records but nothing turns them into a real dispatched ride
-- today. Next concrete step, blocked until lodging nodes have real
-- coordinates populated.
--
-- Verified live: full synthetic chain (merchant -> lodging node -> flight
-- block at tipping point -> package -> captured reservation) correctly
-- produces exactly two notifications -- rider "Trip confirmed" and hotel
-- owner "New group booking confirmed" -- deduplicated per property, not
-- per guest. Caught and fixed 'escape_confirmed' as an invalid
-- notifications.type value along the way ('escape' is the real allowed
-- category) before this could crash on a real confirmation.
--
-- Also found: every merchant row in production has created_by = NULL —
-- no merchant has ever been linked to a real owner login. This is a data
-- gap from onboarding, not a code bug; hotel notification correctly
-- no-ops until merchants are actually linked to real accounts.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.lodging_nodes
    ADD COLUMN IF NOT EXISTS lat double precision,
    ADD COLUMN IF NOT EXISTS lng double precision;

CREATE OR REPLACE FUNCTION public.check_flight_tipping_points()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_block    RECORD;
    v_res      RECORD;
    v_itin_id  UUID;
    v_arrive   TIMESTAMPTZ;
    v_hotel_notified uuid[] := ARRAY[]::uuid[];
    v_hotel_user_id uuid;
    v_hotel_name text;
BEGIN
    FOR v_block IN
        SELECT id, tipping_point_seats, allocated_seats,
               departure_time, outbound_arrival_time, return_time
        FROM public.flight_blocks
        WHERE status = 'POOLING' AND cancel_deadline <= now()
        FOR UPDATE
    LOOP
        IF v_block.allocated_seats >= v_block.tipping_point_seats THEN
            UPDATE public.flight_blocks
            SET status = 'CONFIRMED', confirmed_at = now(), updated_at = now()
            WHERE id = v_block.id;

            FOR v_res IN
                SELECT pr.id AS reservation_id, pr.rider_id, pr.escape_package_id,
                       pr.total_price_cents, pr.guest_count,
                       pr.pickup_lat, pr.pickup_lng,
                       ep.flight_cost_per_person_cents,
                       ep.lodging_cost_per_person_cents,
                       ep.driver_origin_cost_cents,
                       ep.driver_destination_cost_cents,
                       ep.platform_margin_cents,
                       ep.lodging_node_id, ep.package_name
                FROM public.package_reservations pr
                JOIN public.escape_packages ep ON ep.id = pr.escape_package_id
                WHERE pr.flight_block_id = v_block.id AND pr.status = 'CAPTURED'
            LOOP
                UPDATE public.package_reservations
                SET status = 'CONFIRMED', confirmed_at = now(), updated_at = now()
                WHERE id = v_res.reservation_id;

                v_arrive := COALESCE(
                    v_block.outbound_arrival_time,
                    v_block.departure_time + INTERVAL '45 minutes'
                );

                INSERT INTO public.master_escape_itineraries (
                    reservation_id, rider_id, package_id, flight_block_id,
                    total_paid_ttd, status
                ) VALUES (
                    v_res.reservation_id, v_res.rider_id, v_res.escape_package_id,
                    v_block.id,
                    ROUND(v_res.total_price_cents::NUMERIC / 100, 2),
                    'CONFIRMED'
                )
                ON CONFLICT (reservation_id) DO UPDATE SET updated_at = now()
                RETURNING id INTO v_itin_id;

                INSERT INTO public.itinerary_legs (
                    master_itinerary_id, leg_sequence, service_type, status,
                    scheduled_start, scheduled_end, reference_code,
                    pickup_lat, pickup_lng
                ) VALUES
                    (v_itin_id, 1, 'GROUND_TRANSIT', 'scheduled',
                     v_block.departure_time - INTERVAL '3 hours',
                     v_block.departure_time - INTERVAL '1 hour',
                     'TT_AIRPORT_TRANSFER',
                     v_res.pickup_lat, v_res.pickup_lng),
                    (v_itin_id, 2, 'AVIATION', 'scheduled',
                     v_block.departure_time, v_arrive, NULL, NULL, NULL),
                    (v_itin_id, 3, 'GROUND_TRANSIT', 'scheduled',
                     v_arrive, v_arrive + INTERVAL '45 minutes',
                     'DEST_VILLA_TRANSFER', NULL, NULL),
                    (v_itin_id, 4, 'LODGING', 'scheduled',
                     v_arrive + INTERVAL '45 minutes',
                     COALESCE(v_block.return_time, v_block.departure_time + INTERVAL '48 hours'),
                     'VILLA_STAY', NULL, NULL)
                ON CONFLICT (master_itinerary_id, leg_sequence) DO NOTHING;

                INSERT INTO public.transit_financial_ledger (
                    reservation_id, source_party, destination_party, amount_ttd, reference_node_id
                ) VALUES
                    (v_res.reservation_id, 'escrow', 'airline_block',
                     ROUND((v_res.flight_cost_per_person_cents * v_res.guest_count)::NUMERIC / 100, 2),
                     v_block.id::TEXT),
                    (v_res.reservation_id, 'escrow', 'trinidad_driver',
                     ROUND(v_res.driver_origin_cost_cents::NUMERIC / 100, 2), NULL),
                    (v_res.reservation_id, 'escrow', 'tobago_driver',
                     ROUND(v_res.driver_destination_cost_cents::NUMERIC / 100, 2), NULL),
                    (v_res.reservation_id, 'escrow', 'villa_merchant',
                     ROUND((v_res.lodging_cost_per_person_cents * v_res.guest_count)::NUMERIC / 100, 2),
                     v_res.lodging_node_id::TEXT),
                    (v_res.reservation_id, 'escrow', 'platform_profit',
                     ROUND((v_res.platform_margin_cents * v_res.guest_count)::NUMERIC / 100, 2), NULL);

                PERFORM public.notify_user(
                    v_res.rider_id, 'escape',
                    'Trip confirmed! ' || COALESCE(v_res.package_name, 'Your G-Escape'),
                    'Your group hit the tipping point — the trip is on. Check your itinerary.'
                );

                IF v_res.lodging_node_id IS NOT NULL AND NOT (v_res.lodging_node_id = ANY(v_hotel_notified)) THEN
                    SELECT m.created_by, ln.name INTO v_hotel_user_id, v_hotel_name
                    FROM public.lodging_nodes ln
                    JOIN public.merchants m ON m.id = ln.merchant_id
                    WHERE ln.id = v_res.lodging_node_id;

                    IF v_hotel_user_id IS NOT NULL THEN
                        PERFORM public.notify_user(
                            v_hotel_user_id, 'escape',
                            'New group booking confirmed' || COALESCE(': ' || v_hotel_name, ''),
                            'A G-Escape group booking just confirmed for your property. Check your bookings for guest count and dates.'
                        );
                        v_hotel_notified := array_append(v_hotel_notified, v_res.lodging_node_id);
                    END IF;
                END IF;
            END LOOP;

        ELSE
            UPDATE public.flight_blocks
            SET status = 'CANCELLED', allocated_seats = 0, updated_at = now()
            WHERE id = v_block.id;

            UPDATE public.escape_packages
            SET allocated_guests = 0, updated_at = now()
            WHERE flight_block_id = v_block.id;

            UPDATE public.package_reservations
            SET status = 'CANCELLED', updated_at = now()
            WHERE flight_block_id = v_block.id AND status IN ('ACTIVE_HOLD','CAPTURED');
        END IF;
    END LOOP;
END;
$function$;
