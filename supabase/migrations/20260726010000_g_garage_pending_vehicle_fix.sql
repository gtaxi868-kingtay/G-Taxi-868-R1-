-- ═══════════════════════════════════════════════════════════════════
-- G GARAGE FIX: fleet_leases.fleet_vehicle_id is NOT NULL, but a G
-- Garage approval happens BEFORE a physical vehicle is sourced — that's
-- the entire point of the request/approval step preceding sourcing.
-- Caught by a smoke-test dry run (rolled back) before this ever reached
-- a real driver: admin_decide_garage_request tried to insert a
-- fleet_leases row with fleet_vehicle_id = NULL and the NOT NULL
-- constraint correctly rejected it.
--
-- Fix: on approval, create a real fleet_vehicles placeholder row in a
-- new 'pending_sourcing' status (make/model/plate are honestly marked
-- TBD, not invented), then point the fleet_lease at it. Once G Garage
-- (or an admin) actually sources the car, a normal
-- manage_fleet_vehicles 'update' call fills in the real make/model/VIN/
-- plate and flips status to 'leased' — no new mechanism needed for that
-- step, it's the same admin fleet_vehicles editor already in FleetManager.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.fleet_vehicles DROP CONSTRAINT IF EXISTS fleet_vehicles_status_check;
ALTER TABLE public.fleet_vehicles ADD CONSTRAINT fleet_vehicles_status_check
    CHECK (status = ANY (ARRAY['available', 'leased', 'maintenance', 'retired', 'sold', 'pending_sourcing']));

CREATE OR REPLACE FUNCTION public.admin_decide_garage_request(
    p_request_id uuid,
    p_decision   text,
    p_admin_id   uuid,
    p_reason     text DEFAULT NULL
)
RETURNS public.g_garage_requests
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_req       public.g_garage_requests;
    v_lease_id  uuid;
    v_vehicle_id uuid;
    v_class_label text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;
    IF p_decision NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'p_decision must be approved or rejected';
    END IF;

    SELECT * INTO v_req FROM public.g_garage_requests WHERE id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Garage request not found';
    END IF;
    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'Request already decided (status=%)', v_req.status;
    END IF;

    IF p_decision = 'approved' THEN
        SELECT label INTO v_class_label FROM public.vehicle_classes WHERE key = v_req.vehicle_class_key;

        -- Placeholder vehicle row — real make/model/plate get filled in
        -- once the vehicle is actually sourced (via the existing
        -- manage_fleet_vehicles admin editor), same as any other
        -- fleet_vehicles row from that point on.
        INSERT INTO public.fleet_vehicles (
            make, model, year, license_plate, vehicle_type, ownership_type, status, metadata
        ) VALUES (
            'TBD', COALESCE(v_class_label, v_req.vehicle_class_key), EXTRACT(YEAR FROM now())::int,
            'PENDING-' || left(v_req.id::text, 8), v_req.vehicle_class_key, 'financed', 'pending_sourcing',
            jsonb_build_object('g_garage_request_id', v_req.id, 'source', v_req.source)
        )
        RETURNING id INTO v_vehicle_id;

        -- Real fleet_leases row, lease_type='hybrid' per the plan: a
        -- weekly_minimum_cents safety-net floor plus a per_ride_installment
        -- so a driver who does more rides pays down faster without a
        -- second manually-sized tier.
        INSERT INTO public.fleet_leases (
            driver_id, fleet_vehicle_id, start_date, lease_type, daily_rate_cents, weekly_minimum_cents,
            per_ride_installment_cents, status, reserve_funded, metadata
        ) VALUES (
            v_req.driver_id, v_vehicle_id, current_date, 'hybrid',
            v_req.requested_daily_contribution_cents,
            v_req.requested_daily_contribution_cents * 7,
            GREATEST(50, v_req.requested_daily_contribution_cents / 20),
            'active', true,
            jsonb_build_object(
                'g_garage_request_id', v_req.id,
                'vehicle_class_key', v_req.vehicle_class_key,
                'source', v_req.source,
                'platform_match_pct', v_req.platform_match_pct,
                'h_registration_opt_in', v_req.h_registration_opt_in
            )
        )
        RETURNING id INTO v_lease_id;
    END IF;

    UPDATE public.g_garage_requests
    SET status = p_decision,
        decision_reason = p_reason,
        decided_by = p_admin_id,
        decided_at = now(),
        fleet_lease_id = v_lease_id,
        updated_at = now()
    WHERE id = p_request_id
    RETURNING * INTO v_req;

    RETURN v_req;
END;
$$;

-- CREATE OR REPLACE does not reset GRANTs, so this stays service_role-only
-- (see the REVOKE/GRANT + comment in 20260726000000 for why).

NOTIFY pgrst, 'reload schema';
