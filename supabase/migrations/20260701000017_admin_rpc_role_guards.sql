-- Privilege-escalation + admin-data-leak fix (2026-06-29)
-- Source: read-only audit of all 27 admin_* SECURITY DEFINER RPCs (open item from the
-- 2026-06-24 RPC lockdown). Each is SECURITY DEFINER and GRANTed to authenticated (the
-- admin app calls them via .rpc()), but three were missing an internal admin-role check:
--   * admin_set_surge_zone (apps/admin WarChest.tsx) -- any authenticated user could
--     create/overwrite surge-pricing zones.
--   * admin_escape_action (apps/admin EscapeManagement.tsx) -- any authenticated user
--     could confirm/delay/refund_all escape packages (financial actions).
--   * admin_get_reserve_balance (apps/admin) -- any authenticated user could read the
--     platform treasury balance.
-- All other admin_* RPCs already guard correctly (verified). The remaining unguarded
-- admin_get_* (pricing/platform_rates/surge_zones) are plain SQL functions returning
-- low-sensitivity operational data; left as-is (guarding needs a plpgsql rewrite for
-- little gain) -- noted as a low-priority follow-up.
-- Bodies are byte-identical to prod (extracted from baseline; guard injected after BEGIN).
-- Idempotent (CREATE OR REPLACE). Admin app unaffected. Validated via Supabase Preview.

CREATE OR REPLACE FUNCTION "public"."admin_set_surge_zone"("p_lat" double precision, "p_lng" double precision, "p_radius_km" double precision, "p_multiplier" numeric, "p_expires_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_id UUID;
BEGIN
    -- SECURITY (added 2026-06-29): admin-only guard. SECURITY DEFINER fn reachable by
    -- authenticated (called from apps/admin via .rpc) but was missing a role check.
    IF (SELECT role::text FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Unauthorized: admin role required';
    END IF;

    INSERT INTO pricing_zones (
        name, center_lat, center_lng, radius_km,
        surge_multiplier, is_active, expires_at, created_at
    ) VALUES (
        format('Auto surge %.1fx @ %s,%s', p_multiplier, round(p_lat::numeric,4), round(p_lng::numeric,4)),
        p_lat, p_lng, p_radius_km,
        p_multiplier, true,
        COALESCE(p_expires_at, now() + interval '2 hours'),
        now()
    )
    ON CONFLICT (name) DO UPDATE
        SET surge_multiplier = EXCLUDED.surge_multiplier,
            is_active = true,
            expires_at = EXCLUDED.expires_at
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."admin_escape_action"("p_package_id" "uuid", "p_action" "text", "p_booking_ref" "text" DEFAULT NULL::"text", "p_message" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_pkg RECORD;
    v_participants INT;
    v_refunded INT := 0;
    v_rider_record RECORD;
BEGIN
    -- SECURITY (added 2026-06-29): admin-only guard. SECURITY DEFINER fn reachable by
    -- authenticated (called from apps/admin via .rpc) but was missing a role check.
    IF (SELECT role::text FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Unauthorized: admin role required';
    END IF;

    -- Validate action
    IF p_action NOT IN ('confirm', 'delay', 'refund_all') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid action. Use confirm, delay, or refund_all.');
    END IF;

    SELECT * INTO v_pkg FROM escape_packages WHERE id = p_package_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Package not found');
    END IF;

    -- ── CONFIRM ──────────────────────────────────────────────────
    IF p_action = 'confirm' THEN
        -- Update all confirmed/payment_pending participants to passport_pending
        UPDATE escape_group_participants
        SET status = 'passport_pending', confirmed_at = COALESCE(confirmed_at, now())
        WHERE package_id = p_package_id
          AND status IN ('confirmed', 'payment_pending');

        GET DIAGNOSTICS v_participants = ROW_COUNT;

        -- Store booking reference if provided
        IF p_booking_ref IS NOT NULL THEN
            UPDATE escape_packages SET charter_reference = p_booking_ref WHERE id = p_package_id;
        END IF;

        -- Log alert
        INSERT INTO group_booking_alerts (package_id, alert_type, message)
        VALUES (p_package_id, 'reschedule_accepted',
                'Admin confirmed ' || v_participants || ' participants. Ref: ' || COALESCE(p_booking_ref, 'N/A'));

        RETURN jsonb_build_object(
            'success', true,
            'participants_confirmed', v_participants,
            'package', v_pkg.package_name,
            'booking_reference', p_booking_ref
        );
    END IF;

    -- ── DELAY ────────────────────────────────────────────────────
    IF p_action = 'delay' THEN
        INSERT INTO group_booking_alerts (package_id, alert_type, message)
        VALUES (p_package_id, 'delay', COALESCE(p_message, 'Trip delayed by admin'));

        RETURN jsonb_build_object(
            'success', true,
            'message', 'Delay alert broadcast',
            'detail', p_message
        );
    END IF;

    -- ── REFUND ALL ───────────────────────────────────────────────
    IF p_action = 'refund_all' THEN
        FOR v_rider_record IN
            SELECT id, rider_id, paid_cents
            FROM escape_group_participants
            WHERE package_id = p_package_id
              AND status IN ('confirmed', 'passport_pending', 'travel_ready', 'payment_pending', 'intent_pending')
        LOOP
            IF v_rider_record.paid_cents > 0 THEN
                PERFORM credit_wallet(
                    v_rider_record.rider_id,
                    v_rider_record.paid_cents,
                    'travel_package_refund',
                    'Full refund — trip cancelled by admin',
                    v_rider_record.id
                );
            END IF;

            UPDATE escape_group_participants
            SET status = CASE WHEN v_rider_record.paid_cents > 0 THEN 'refunded' ELSE 'cancelled' END
            WHERE id = v_rider_record.id;

            v_refunded := v_refunded + 1;
        END LOOP;

        INSERT INTO group_booking_alerts (package_id, alert_type, message)
        VALUES (p_package_id, 'refund_completed',
                'Admin refunded ' || v_refunded || ' participants for cancelled trip');

        RETURN jsonb_build_object('success', true, 'refunded', v_refunded);
    END IF;

    RETURN jsonb_build_object('success', false, 'error', 'Unhandled action');
END;
$$;

CREATE OR REPLACE FUNCTION "public"."admin_get_reserve_balance"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_locked BIGINT; v_deployed BIGINT; v_released BIGINT; v_total BIGINT;
BEGIN
    -- SECURITY (added 2026-06-29): admin-only guard. SECURITY DEFINER fn reachable by
    -- authenticated (called from apps/admin via .rpc) but was missing a role check.
    IF (SELECT role::text FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Unauthorized: admin role required';
    END IF;

  SELECT
    SUM(CASE WHEN status = 'locked'   THEN amount_cents ELSE 0 END),
    SUM(CASE WHEN status = 'deployed' THEN amount_cents ELSE 0 END),
    SUM(CASE WHEN status = 'released' THEN amount_cents ELSE 0 END),
    SUM(amount_cents)
  INTO v_locked, v_deployed, v_released, v_total FROM capital_reserve_ledger;
  RETURN jsonb_build_object(
    'locked_cents', COALESCE(v_locked,0), 'deployed_cents', COALESCE(v_deployed,0),
    'released_cents', COALESCE(v_released,0), 'total_cents', COALESCE(v_total,0)
  );
END;
$$;
