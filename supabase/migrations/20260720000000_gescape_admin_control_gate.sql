-- ═══════════════════════════════════════════════════════════════════
-- G-ESCAPE: ADMIN FINAL CONTROL + AUTO-RELEASE FALLBACK (2026-07-16)
--
-- Found while exploring this: there are TWO entirely disconnected
-- G-Escape booking systems live in production simultaneously.
--   1. flight_blocks/package_reservations — one-shot wallet capture at
--      booking, auto-confirmed with zero human step by
--      check_flight_tipping_points (daily cron, no admin visibility at
--      all). This is the CURRENT/correct system (secure_escape_booking,
--      the one settlement v3's hotel-notification fix touched).
--   2. escape_group_participants/escape_packages — an older, still-live
--      parallel system with its own cron (auto-charge-escape-group-5min)
--      AND the only real admin UI in the codebase
--      (apps/admin/src/pages/EscapeManagement.tsx, backed by
--      admin_escape_action). This UI's Confirm/Delay/Refund buttons do
--      NOTHING to a booking made through system #1 — admin cannot see
--      or intervene in the system riders actually book through today.
--
-- Owner's explicit fix: give admin real final control to manually
-- release a confirmed group to the airline/hotel/drivers, but if the
-- group fills to full capacity before admin acts, don't miss the
-- window — auto-book anyway. Same for a hard safety deadline as
-- departure approaches, so nothing is ever lost to inaction.
--
-- This salvages the one good part of the stale system (a human "send"
-- step) and applies it to the system that's actually live, using the
-- existing g_proposed_actions/g_decide_action/g_execute_action
-- governance pattern already proven tonight (same one G's departments
-- use) rather than inventing a new approval mechanism.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. Confirmation logic, extracted so both admin-approval and the
--        auto-release safety net call the exact same code path ──────
CREATE OR REPLACE FUNCTION public.execute_escape_group_confirmation(p_flight_block_id uuid)
RETURNS jsonb
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
    v_confirmed_count integer := 0;
BEGIN
    SELECT id, tipping_point_seats, allocated_seats,
           departure_time, outbound_arrival_time, return_time
    INTO v_block
    FROM public.flight_blocks
    WHERE id = p_flight_block_id AND status = 'POOLING'
    FOR UPDATE;

    IF v_block.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Block not found or not in POOLING status');
    END IF;

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

        v_confirmed_count := v_confirmed_count + 1;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'flight_block_id', v_block.id, 'reservations_confirmed', v_confirmed_count);
END;
$function$;

-- ─── 2. Sweep: propose to admin at tipping point, auto-release on the ──
--        full-capacity or imminent-departure safety net ──────────────
CREATE OR REPLACE FUNCTION public.escape_sweep_tipping_points()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_block RECORD;
    v_existing_proposal RECORD;
    v_margin_cents bigint;
    v_package_name text;
    v_guest_total integer;
BEGIN
    -- ── Cancel path: unchanged — deadline passed, never reached tipping point ──
    FOR v_block IN
        SELECT id FROM public.flight_blocks
        WHERE status = 'POOLING' AND cancel_deadline <= now()
          AND allocated_seats < tipping_point_seats
        FOR UPDATE
    LOOP
        UPDATE public.flight_blocks SET status = 'CANCELLED', allocated_seats = 0, updated_at = now() WHERE id = v_block.id;
        UPDATE public.escape_packages SET allocated_guests = 0, updated_at = now() WHERE flight_block_id = v_block.id;
        UPDATE public.package_reservations SET status = 'CANCELLED', updated_at = now()
        WHERE flight_block_id = v_block.id AND status IN ('ACTIVE_HOLD','CAPTURED');
    END LOOP;

    -- ── Fast path: FULL capacity — book immediately, no admin wait. ──
    -- "fall back to auto booking if it fills before admin hits send."
    FOR v_block IN
        SELECT id FROM public.flight_blocks
        WHERE status = 'POOLING' AND allocated_seats >= total_capacity_seats
        FOR UPDATE
    LOOP
        PERFORM public.execute_escape_group_confirmation(v_block.id);
        UPDATE public.g_proposed_actions
        SET status = 'executed', decided_at = now(),
            execution_result = jsonb_build_object('auto_released', true, 'reason', 'full_capacity')
        WHERE action_type = 'escape_confirm_group'
          AND (payload->>'flight_block_id')::uuid = v_block.id
          AND status = 'pending';
    END LOOP;

    -- ── Tipping point reached, not full, deadline passed: propose to ──
    -- admin for final control. Dedup — only one live proposal per block.
    FOR v_block IN
        SELECT id, tipping_point_seats, allocated_seats, total_capacity_seats,
               departure_time, destination_name
        FROM public.flight_blocks
        WHERE status = 'POOLING'
          AND cancel_deadline <= now()
          AND allocated_seats >= tipping_point_seats
        FOR UPDATE
    LOOP
        SELECT id INTO v_existing_proposal
        FROM public.g_proposed_actions
        WHERE action_type = 'escape_confirm_group'
          AND (payload->>'flight_block_id')::uuid = v_block.id
          AND status IN ('pending', 'approved', 'executed')
        LIMIT 1;

        IF v_existing_proposal.id IS NULL THEN
            SELECT COALESCE(SUM(ep.platform_margin_cents * pr.guest_count), 0),
                   MAX(ep.package_name), COALESCE(SUM(pr.guest_count), 0)
            INTO v_margin_cents, v_package_name, v_guest_total
            FROM public.package_reservations pr
            JOIN public.escape_packages ep ON ep.id = pr.escape_package_id
            WHERE pr.flight_block_id = v_block.id AND pr.status = 'CAPTURED';

            INSERT INTO public.g_proposed_actions
                (department, action_type, title, reasoning, category, amount_cents, payload)
            VALUES (
                'ops', 'escape_confirm_group',
                format('Release G-Escape group: %s (%s guests)', COALESCE(v_package_name, 'Package'), v_guest_total),
                format('Flight block hit its tipping point (%s/%s seats) and its hold deadline has passed. Confirming releases the group to the airline, hotel, and transfer drivers, and captures the platform margin. Auto-releases on its own if seats fill completely or departure (%s) gets within 24 hours — this proposal is your window to review first.',
                       v_block.allocated_seats, v_block.tipping_point_seats, v_block.departure_time::text),
                'money', v_margin_cents,
                jsonb_build_object('flight_block_id', v_block.id, 'destination', v_block.destination_name, 'departure_time', v_block.departure_time)
            );
        END IF;
    END LOOP;

    -- ── Safety net: admin hasn't acted and departure is getting close. ──
    -- Never miss a real flight/hotel window to inaction.
    FOR v_block IN
        SELECT (payload->>'flight_block_id')::uuid AS flight_block_id, id AS proposal_id
        FROM public.g_proposed_actions
        WHERE action_type = 'escape_confirm_group' AND status = 'pending'
          AND (payload->>'departure_time')::timestamptz <= now() + interval '24 hours'
    LOOP
        PERFORM public.execute_escape_group_confirmation(v_block.flight_block_id);
        UPDATE public.g_proposed_actions
        SET status = 'executed', decided_at = now(),
            execution_result = jsonb_build_object('auto_released', true, 'reason', 'departure_imminent_no_admin_action')
        WHERE id = v_block.proposal_id;
    END LOOP;
END;
$function$;

-- ─── 3. Keep the existing cron target name working — it now runs the ──
--        propose/auto-release sweep instead of unconditional auto-confirm.
CREATE OR REPLACE FUNCTION public.check_flight_tipping_points()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    PERFORM public.escape_sweep_tipping_points();
END;
$function$;

-- ─── 4. Run the sweep every 15 minutes, not once a day — the full- ────
--        capacity fast path and the admin proposal shouldn't wait on a
--        once-daily cron.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-escape-tipping-points') THEN
        PERFORM cron.unschedule('check-escape-tipping-points');
    END IF;
END $$;

SELECT cron.schedule('check-escape-tipping-points', '*/15 * * * *', $job$SELECT public.check_flight_tipping_points()$job$);

NOTIFY pgrst, 'reload schema';
