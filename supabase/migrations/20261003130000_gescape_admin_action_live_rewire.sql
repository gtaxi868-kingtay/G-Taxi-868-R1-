-- ═══════════════════════════════════════════════════════════════════
-- G-ESCAPE: admin_escape_action rewired to the LIVE booking system
-- (package_reservations/flight_blocks), not the legacy one
-- (escape_group_participants).
--
-- Context (confirmed live, 2026-10-03): 20260720000000_gescape_admin_control_gate.sql
-- already gave admin real final control over GROUP RELEASE on the live
-- system -- escape_sweep_tipping_points proposes 'escape_confirm_group' to
-- g_proposed_actions, which Approvals.tsx + g_execute_action settle by
-- calling execute_escape_group_confirmation(flight_block_id). That path is
-- untouched here.
--
-- What was still broken: EscapeManagement.tsx (the admin page) is the one
-- OTHER place admin can act on an escape package, and its Confirm/Delay/
-- Refund-All buttons call admin_escape_action, which -- in BOTH of its two
-- existing overloads -- reads and writes only escape_group_participants.
-- Confirmed live: zero rows have ever existed in package_reservations, but
-- that's the table real riders book through (travel/index.ts's book_escape
-- action). Clicking "Confirm" or "Refund All" in this admin page for a
-- real, live booking did NOTHING and reported success anyway.
--
-- Two overloads exist today because a prior edit added a trailing
-- (p_departure_date, p_arrival_date) pair via CREATE OR REPLACE, which
-- creates a NEW overload rather than altering the original (see
-- CLAUDE.md's migration rules on this exact footgun). Grepping the entire
-- repo found zero callers of the 6-arg version -- EscapeManagement.tsx only
-- ever calls the 4-arg shape. Both are dropped and replaced with one.
--
-- Fixes, by action:
--   'confirm'    -- now calls the SAME execute_escape_group_confirmation
--                   already used by the approval-inbox path, as a manual
--                   admin override for the package's linked flight_block.
--                   Not reimplemented -- the money-ledger-writing logic
--                   inside that function is untouched. A block already
--                   confirmed (status != 'POOLING') returns success:false
--                   with a clear reason instead of silently no-opping.
--   'delay'      -- unchanged. group_booking_alerts is keyed by
--                   package_id, which both systems share (escape_packages
--                   is the common parent row) -- this action was never
--                   actually broken, just mis-filed under "legacy" because
--                   its sibling actions were.
--   'refund_all' -- now reads/writes package_reservations instead of
--                   escape_group_participants, crediting the SAME
--                   credit_wallet() with the SAME dedup-by-reference_id
--                   guarantee the legacy path relied on, keyed by the real
--                   reservation id.
--
-- No table is dropped or altered. escape_group_participants keeps existing
-- (something else -- auto_charge_escape_group's cron path -- still writes
-- to it; migrating THAT is a separate, larger change not in scope here).
-- ═══════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.admin_escape_action(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.admin_escape_action(uuid, text, timestamptz, timestamptz, text, text);

CREATE FUNCTION public.admin_escape_action(
    p_package_id uuid,
    p_action text,
    p_booking_ref text DEFAULT NULL,
    p_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_pkg RECORD;
    v_confirm_result jsonb;
    v_refunded INT := 0;
    v_res RECORD;
BEGIN
    IF (SELECT role::text FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Unauthorized: admin role required';
    END IF;

    IF p_action NOT IN ('confirm', 'delay', 'refund_all') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid action. Use confirm, delay, or refund_all.');
    END IF;

    SELECT * INTO v_pkg FROM public.escape_packages WHERE id = p_package_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Package not found');
    END IF;

    -- ── CONFIRM (manual admin override of the live release path) ───
    IF p_action = 'confirm' THEN
        IF v_pkg.flight_block_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Package has no linked flight_block — nothing live to release.');
        END IF;

        v_confirm_result := public.execute_escape_group_confirmation(v_pkg.flight_block_id);

        IF p_booking_ref IS NOT NULL THEN
            UPDATE public.escape_packages SET charter_reference = p_booking_ref WHERE id = p_package_id;
        END IF;

        INSERT INTO public.group_booking_alerts (package_id, alert_type, message)
        VALUES (
            p_package_id, 'reschedule_accepted',
            CASE WHEN (v_confirm_result->>'success')::boolean IS TRUE
                 THEN 'Admin manually released ' || COALESCE(v_confirm_result->>'reservations_confirmed', '0') || ' reservations. Ref: ' || COALESCE(p_booking_ref, 'N/A')
                 ELSE 'Admin attempted manual release — ' || COALESCE(v_confirm_result->>'error', 'already released or not pooling')
            END
        );

        RETURN jsonb_build_object(
            'success', COALESCE((v_confirm_result->>'success')::boolean, false),
            'reservations_confirmed', v_confirm_result->'reservations_confirmed',
            'package', v_pkg.package_name,
            'booking_reference', p_booking_ref,
            'detail', CASE WHEN (v_confirm_result->>'success')::boolean IS NOT TRUE
                           THEN COALESCE(v_confirm_result->>'error', 'Block not in POOLING status — may already be released')
                           ELSE NULL END
        );
    END IF;

    -- ── DELAY (unchanged — package_id-keyed, system-agnostic) ──────
    IF p_action = 'delay' THEN
        INSERT INTO public.group_booking_alerts (package_id, alert_type, message)
        VALUES (p_package_id, 'delay', COALESCE(p_message, 'Trip delayed by admin'));

        RETURN jsonb_build_object(
            'success', true,
            'message', 'Delay alert broadcast',
            'detail', p_message
        );
    END IF;

    -- ── REFUND ALL (rewired to the live reservations) ───────────────
    IF p_action = 'refund_all' THEN
        FOR v_res IN
            SELECT id, rider_id, total_price_cents
            FROM public.package_reservations
            WHERE escape_package_id = p_package_id
              AND status IN ('ACTIVE_HOLD', 'CAPTURED', 'CONFIRMED')
        LOOP
            IF v_res.total_price_cents > 0 THEN
                PERFORM public.credit_wallet(
                    v_res.rider_id,
                    v_res.total_price_cents,
                    'travel_package_refund',
                    'Full refund — trip cancelled by admin',
                    v_res.id::text
                );
            END IF;

            -- package_reservations_status_check has no distinct 'REFUNDED'
            -- state (confirmed live: PENDING_HOLD/ACTIVE_HOLD/CAPTURED/
            -- CONFIRMED/EN_ROUTE_DEPART/ON_ISLAND/EN_ROUTE_RETURN/COMPLETED/
            -- RELEASED/CANCELLED) -- CANCELLED is the terminal state for
            -- both the credited and zero-amount case here.
            UPDATE public.package_reservations
            SET status = 'CANCELLED', updated_at = now()
            WHERE id = v_res.id;

            v_refunded := v_refunded + 1;
        END LOOP;

        INSERT INTO public.group_booking_alerts (package_id, alert_type, message)
        VALUES (p_package_id, 'refund_completed',
                'Admin refunded ' || v_refunded || ' live reservations for cancelled trip');

        RETURN jsonb_build_object('success', true, 'refunded', v_refunded);
    END IF;

    RETURN jsonb_build_object('success', false, 'error', 'Unhandled action');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_escape_action(uuid, text, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
