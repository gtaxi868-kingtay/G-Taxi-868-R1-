-- G-Escape lane demand aggregation → airline-lane reopening mechanic.
--
-- Riders register interest in a route+month ("waitlist"); an aggregate view turns
-- that into a per-lane demand case; the existing 15-minute escape sweep files a
-- g_proposed_actions 'escape_open_lane' proposal when a lane's wanted seats cross
-- 60% of a typical block. Admin approval (via g_execute_action's reviewed handler)
-- drafts a hidden DRAFT flight_block for ops to attach real cost/dates before
-- flipping to POOLING. Opening a lane is a business negotiation with an airline —
-- deliberately NO auto-open fallback (unlike group confirmation).
--
-- Money-free: no wallet writes anywhere in this path.

-- ── 1. Interest list ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.escape_lane_interest (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    origin_code text NOT NULL DEFAULT 'POS',
    destination_code text NOT NULL,
    destination_name text,
    travel_month date NOT NULL,
    party_size integer NOT NULL DEFAULT 1 CHECK (party_size BETWEEN 1 AND 10),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT escape_lane_interest_month_first CHECK (travel_month = date_trunc('month', travel_month)::date),
    CONSTRAINT escape_lane_interest_unique UNIQUE (rider_id, origin_code, destination_code, travel_month)
);

ALTER TABLE public.escape_lane_interest ENABLE ROW LEVEL SECURITY;

CREATE POLICY eli_insert_own ON public.escape_lane_interest
    FOR INSERT TO authenticated WITH CHECK (rider_id = auth.uid());
CREATE POLICY eli_select_own ON public.escape_lane_interest
    FOR SELECT TO authenticated USING (rider_id = auth.uid());
CREATE POLICY eli_delete_own ON public.escape_lane_interest
    FOR DELETE TO authenticated USING (rider_id = auth.uid());
-- no UPDATE policy: change of plans = delete + re-add

-- ── 2. Aggregate demand per lane ─────────────────────────────────────────────
CREATE OR REPLACE VIEW public.escape_lane_demand AS
SELECT origin_code,
       destination_code,
       max(destination_name) AS destination_name,
       travel_month,
       sum(party_size)::int AS seats_wanted,
       count(DISTINCT rider_id)::int AS riders,
       min(created_at) AS first_interest_at,
       max(created_at) AS latest_interest_at
FROM public.escape_lane_interest
GROUP BY origin_code, destination_code, travel_month;

GRANT SELECT ON public.escape_lane_demand TO authenticated;

-- ── 3. DRAFT status for admin-only blocks ────────────────────────────────────
-- Rider-facing queries filter to POOLING/CONFIRMED (verified: EscapeStorefront
-- uses .in('flight_blocks.status', ['POOLING','CONFIRMED'])), so DRAFT is
-- invisible until ops flips it.
ALTER TABLE public.flight_blocks DROP CONSTRAINT flight_blocks_status_check;
ALTER TABLE public.flight_blocks ADD CONSTRAINT flight_blocks_status_check
    CHECK (status = ANY (ARRAY['DRAFT'::text, 'POOLING'::text, 'CONFIRMED'::text, 'CANCELLED'::text]));

-- ── 4. Extend the 15-minute sweep with the lane-demand scan ──────────────────
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
    v_lane RECORD;
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

    -- ── Lane demand: enough riders waiting on a route+month with no block ──
    -- covering it → file the demand case for admin. Approval drafts the block
    -- (reviewed handler); opening a lane stays a human decision — no auto-open.
    FOR v_lane IN
        SELECT d.origin_code, d.destination_code, d.destination_name,
               d.travel_month, d.seats_wanted, d.riders,
               COALESCE((SELECT fb.total_capacity_seats FROM public.flight_blocks fb
                         WHERE fb.origin_code = d.origin_code
                           AND fb.destination_code = d.destination_code
                         ORDER BY fb.created_at DESC LIMIT 1), 60) AS ref_capacity
        FROM public.escape_lane_demand d
        WHERE d.travel_month >= date_trunc('month', now())::date
    LOOP
        IF v_lane.seats_wanted >= ceil(0.6 * v_lane.ref_capacity)
           AND NOT EXISTS (
               SELECT 1 FROM public.flight_blocks fb
               WHERE fb.origin_code = v_lane.origin_code
                 AND fb.destination_code = v_lane.destination_code
                 AND fb.status IN ('DRAFT', 'POOLING', 'CONFIRMED')
                 AND date_trunc('month', fb.departure_time)::date = v_lane.travel_month
           )
           AND NOT EXISTS (
               SELECT 1 FROM public.g_proposed_actions
               WHERE action_type = 'escape_open_lane'
                 AND payload->>'lane_key' =
                     v_lane.origin_code || '-' || v_lane.destination_code || '-' || v_lane.travel_month::text
                 AND (status = 'pending' OR created_at > now() - interval '7 days')
           )
        THEN
            INSERT INTO public.g_proposed_actions
                (department, action_type, title, reasoning, category, amount_cents, payload)
            VALUES (
                'escape', 'escape_open_lane',
                format('Open G-Escape lane: %s → %s (%s)',
                       v_lane.origin_code,
                       COALESCE(v_lane.destination_name, v_lane.destination_code),
                       to_char(v_lane.travel_month, 'Mon YYYY')),
                format('%s riders joined the interest list wanting %s seats for %s — %s%% of a typical %s-seat block. That is a demand case an airline can act on. Approving drafts the flight block (DRAFT status, hidden from riders) so ops can attach real flight cost and dates before flipping it to POOLING.',
                       v_lane.riders, v_lane.seats_wanted, to_char(v_lane.travel_month, 'Mon YYYY'),
                       round(100.0 * v_lane.seats_wanted / v_lane.ref_capacity), v_lane.ref_capacity),
                'other', 0,
                jsonb_build_object(
                    'lane_key', v_lane.origin_code || '-' || v_lane.destination_code || '-' || v_lane.travel_month::text,
                    'origin_code', v_lane.origin_code,
                    'destination_code', v_lane.destination_code,
                    'destination_name', v_lane.destination_name,
                    'travel_month', v_lane.travel_month,
                    'seats_wanted', v_lane.seats_wanted,
                    'riders', v_lane.riders,
                    'ref_capacity', v_lane.ref_capacity
                )
            );
        END IF;
    END LOOP;
END;
$function$;
