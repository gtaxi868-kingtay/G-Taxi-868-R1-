-- ═══════════════════════════════════════════════════════════════════
-- DRIVER NETWORK MARKETPLACE — scoreboard + request/approve joining
--
-- Until now a driver could only enter a commander's network one way:
-- typing that commander's onboarding code at signup
-- (register_driver_with_code). Nothing let a driver SEE which networks
-- exist or how they perform, and an already-registered driver had no
-- way to join (or move to) a network at all.
--
-- This adds:
--   1. get_driver_networks()        — public scoreboard of active networks
--                                     (rides/day, driver earnings/day,
--                                     driver count). Aggregates only; never
--                                     exposes onboarding codes or contacts.
--   2. network_join_requests        — a driver ASKS to join; the network's
--                                     owner approves or declines. Vouching
--                                     stays meaningful: no driver can attach
--                                     themselves to a business's name alone.
--   3. request / cancel / decide RPCs, plus status + inbox readers.
--
-- Money effect is confined to ONE column, the same one the signup path
-- already writes: drivers.recruited_by_commander_user_id (+ recruited_at).
-- compute_ride_split already pays the 2% to that user while they hold an
-- active pod_commanders row; nothing in settlement changes.
--
-- Switching (founder decision 2026-10-09): a driver already in a network
-- may move, but only 30+ days after they last joined one. The previous
-- network stops earning from the next ride; it is told, not asked.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.network_join_requests (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id         uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
    driver_user_id    uuid NOT NULL,
    commander_id      uuid NOT NULL REFERENCES public.pod_commanders(id) ON DELETE CASCADE,
    commander_user_id uuid NOT NULL,
    status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
    message           text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    decided_at        timestamptz
);

-- One open request per driver at a time.
CREATE UNIQUE INDEX IF NOT EXISTS network_join_requests_one_pending_per_driver
    ON public.network_join_requests (driver_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS network_join_requests_commander_pending
    ON public.network_join_requests (commander_user_id) WHERE status = 'pending';

ALTER TABLE public.network_join_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "njr_driver_reads_own" ON public.network_join_requests;
CREATE POLICY "njr_driver_reads_own" ON public.network_join_requests
    FOR SELECT USING (driver_user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "njr_commander_reads_own" ON public.network_join_requests;
CREATE POLICY "njr_commander_reads_own" ON public.network_join_requests
    FOR SELECT USING (commander_user_id = (SELECT auth.uid()));

-- Writes only through the RPCs below.
REVOKE ALL ON public.network_join_requests FROM anon, authenticated;
GRANT SELECT ON public.network_join_requests TO authenticated;

-- ─── Display name for a network: the business it belongs to, else the
--     commander's own name. Internal helper, not callable by clients. ───
CREATE OR REPLACE FUNCTION public.network_display_name(p_commander_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT COALESCE(
        (SELECT m.name FROM public.merchants m
          WHERE m.created_by = p_commander_user_id
          ORDER BY m.is_active DESC, m.created_at ASC LIMIT 1),
        (SELECT NULLIF(trim(p.full_name), '') FROM public.profiles p WHERE p.id = p_commander_user_id),
        'G network'
    );
$function$;
REVOKE ALL ON FUNCTION public.network_display_name(uuid) FROM PUBLIC, anon, authenticated;

-- ─── 1. Scoreboard ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_driver_networks()
RETURNS TABLE (
    commander_id           uuid,
    network_name           text,
    area                   text,
    is_business            boolean,
    driver_count           integer,
    rides_30d              integer,
    rides_per_day          numeric,
    driver_earnings_per_day_cents integer,
    avg_fare_cents         integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
    WITH nets AS (
        SELECT pc.id, pc.user_id, pc.territory_id
        FROM public.pod_commanders pc
        WHERE pc.status = 'active'
    ),
    members AS (
        SELECT n.id AS commander_id, d.id AS driver_id
        FROM nets n
        JOIN public.drivers d ON d.recruited_by_commander_user_id = n.user_id
        WHERE COALESCE(d.is_bot, false) = false
    ),
    trips AS (
        SELECT m.commander_id,
               count(r.id)                            AS rides,
               COALESCE(sum(r.driver_payout_cents), 0) AS payout,
               COALESCE(avg(r.total_fare_cents), 0)    AS avg_fare
        FROM members m
        JOIN public.rides r ON r.driver_id = m.driver_id
        WHERE r.status = 'completed'
          AND r.completed_at >= now() - interval '30 days'
        GROUP BY m.commander_id
    )
    SELECT
        n.id,
        public.network_display_name(n.user_id),
        COALESCE(
            (SELECT NULLIF(trim(m.address), '') FROM public.merchants m
              WHERE m.created_by = n.user_id ORDER BY m.is_active DESC, m.created_at ASC LIMIT 1),
            (SELECT t.name FROM public.territories t WHERE t.id = n.territory_id)
        ),
        EXISTS (SELECT 1 FROM public.merchants m WHERE m.created_by = n.user_id),
        (SELECT count(*)::int FROM members mm WHERE mm.commander_id = n.id),
        COALESCE(t.rides, 0)::int,
        round(COALESCE(t.rides, 0) / 30.0, 1),
        CASE WHEN (SELECT count(*) FROM members mm WHERE mm.commander_id = n.id) = 0 THEN 0
             ELSE (COALESCE(t.payout, 0) / (SELECT count(*) FROM members mm WHERE mm.commander_id = n.id) / 30)::int
        END,
        round(COALESCE(t.avg_fare, 0))::int
    FROM nets n
    LEFT JOIN trips t ON t.commander_id = n.id
    ORDER BY COALESCE(t.rides, 0) DESC,
             (SELECT count(*) FROM members mm WHERE mm.commander_id = n.id) DESC,
             public.network_display_name(n.user_id) ASC;
$function$;
REVOKE ALL ON FUNCTION public.get_driver_networks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_driver_networks() TO authenticated;

-- ─── 2. Driver: where am I, and what have I asked for ───────────────
CREATE OR REPLACE FUNCTION public.get_my_network_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_driver  RECORD;
    v_current RECORD;
    v_pending RECORD;
BEGIN
    SELECT id, recruited_by_commander_user_id, recruited_at INTO v_driver
    FROM public.drivers WHERE user_id = auth.uid();
    IF v_driver.id IS NULL THEN
        RETURN jsonb_build_object('is_driver', false);
    END IF;

    -- Always run (a NULL key just yields an all-NULL row): reading a field
    -- of a never-assigned RECORD raises in plpgsql.
    SELECT pc.id, pc.status INTO v_current
    FROM public.pod_commanders pc WHERE pc.user_id = v_driver.recruited_by_commander_user_id LIMIT 1;

    SELECT r.id, r.commander_id, r.created_at, r.commander_user_id INTO v_pending
    FROM public.network_join_requests r
    WHERE r.driver_id = v_driver.id AND r.status = 'pending' LIMIT 1;

    RETURN jsonb_build_object(
        'is_driver', true,
        'current_commander_id', v_current.id,
        'current_network_name', CASE WHEN v_driver.recruited_by_commander_user_id IS NULL THEN NULL
                                     ELSE public.network_display_name(v_driver.recruited_by_commander_user_id) END,
        'current_network_active', COALESCE(v_current.status = 'active', false),
        'joined_at', v_driver.recruited_at,
        'can_switch_at', CASE WHEN v_driver.recruited_by_commander_user_id IS NULL OR v_driver.recruited_at IS NULL THEN NULL
                              ELSE v_driver.recruited_at + interval '30 days' END,
        'pending_request_id', v_pending.id,
        'pending_commander_id', v_pending.commander_id,
        'pending_network_name', CASE WHEN v_pending.id IS NULL THEN NULL
                                     ELSE public.network_display_name(v_pending.commander_user_id) END,
        'pending_since', v_pending.created_at
    );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_my_network_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_network_status() TO authenticated;

-- ─── 3. Driver: ask to join ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_network_join(p_commander_id uuid, p_message text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_driver    RECORD;
    v_commander RECORD;
    v_req_id    uuid;
BEGIN
    SELECT id, name, recruited_by_commander_user_id, recruited_at INTO v_driver
    FROM public.drivers WHERE user_id = auth.uid();
    IF v_driver.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only registered drivers can join a network.');
    END IF;

    SELECT id, user_id, status INTO v_commander FROM public.pod_commanders WHERE id = p_commander_id;
    IF v_commander.id IS NULL OR v_commander.status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'That network is not taking drivers right now.');
    END IF;
    IF v_commander.user_id = auth.uid() THEN
        RETURN jsonb_build_object('success', false, 'error', 'You can''t join your own network.');
    END IF;
    IF v_driver.recruited_by_commander_user_id = v_commander.user_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'You''re already in this network.');
    END IF;
    IF v_driver.recruited_by_commander_user_id IS NOT NULL
       AND v_driver.recruited_at IS NOT NULL
       AND v_driver.recruited_at > now() - interval '30 days' THEN
        RETURN jsonb_build_object('success', false,
            'error', 'You can switch networks again on ' || to_char(v_driver.recruited_at + interval '30 days', 'FMDD Mon YYYY') || '.');
    END IF;

    -- Replace any earlier open request rather than stacking them.
    UPDATE public.network_join_requests
    SET status = 'cancelled', decided_at = now()
    WHERE driver_id = v_driver.id AND status = 'pending';

    INSERT INTO public.network_join_requests (driver_id, driver_user_id, commander_id, commander_user_id, message)
    VALUES (v_driver.id, auth.uid(), v_commander.id, v_commander.user_id, NULLIF(trim(p_message), ''))
    RETURNING id INTO v_req_id;

    PERFORM public.notify_user(
        v_commander.user_id, 'grid',
        'A driver wants to join your network',
        COALESCE(v_driver.name, 'A driver') || ' asked to drive under your name. Approve or decline in the app.'
    );

    RETURN jsonb_build_object('success', true, 'request_id', v_req_id,
        'network_name', public.network_display_name(v_commander.user_id));
END;
$function$;
REVOKE ALL ON FUNCTION public.request_network_join(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_network_join(uuid, text) TO authenticated;

-- ─── 4. Driver: withdraw an open request ────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_network_join(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    UPDATE public.network_join_requests
    SET status = 'cancelled', decided_at = now()
    WHERE id = p_request_id AND driver_user_id = auth.uid() AND status = 'pending';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'No open request to cancel.');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.cancel_network_join(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_network_join(uuid) TO authenticated;

-- ─── 5. Network owner: who's asking ─────────────────────────────────
-- drivers RLS hides other drivers from a commander, so the inbox is read
-- here, scoped strictly to requests addressed to the caller.
CREATE OR REPLACE FUNCTION public.get_network_join_requests()
RETURNS TABLE (
    request_id        uuid,
    requested_at      timestamptz,
    message           text,
    driver_name       text,
    vehicle_type      text,
    vehicle_model     text,
    rating            numeric,
    rating_count      integer,
    verified          boolean,
    completed_rides   integer,
    current_network   text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT r.id, r.created_at, r.message,
           d.name, d.vehicle_type, d.vehicle_model,
           d.rating::numeric, d.rating_count::int,
           COALESCE(d.is_verified, false),
           (SELECT count(*)::int FROM public.rides x WHERE x.driver_id = d.id AND x.status = 'completed'),
           CASE WHEN d.recruited_by_commander_user_id IS NULL THEN NULL
                ELSE public.network_display_name(d.recruited_by_commander_user_id) END
    FROM public.network_join_requests r
    JOIN public.drivers d ON d.id = r.driver_id
    WHERE r.commander_user_id = auth.uid() AND r.status = 'pending'
    ORDER BY r.created_at ASC;
$function$;
REVOKE ALL ON FUNCTION public.get_network_join_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_network_join_requests() TO authenticated;

-- ─── 6. Network owner: approve or decline ───────────────────────────
CREATE OR REPLACE FUNCTION public.decide_network_join(p_request_id uuid, p_approve boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_req    RECORD;
    v_driver RECORD;
    v_name   text;
BEGIN
    SELECT * INTO v_req FROM public.network_join_requests WHERE id = p_request_id FOR UPDATE;
    IF v_req.id IS NULL OR v_req.commander_user_id IS DISTINCT FROM auth.uid() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request not found.');
    END IF;
    IF v_req.status <> 'pending' THEN
        RETURN jsonb_build_object('success', false, 'error', 'This request was already ' || v_req.status || '.');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.pod_commanders WHERE id = v_req.commander_id AND status = 'active') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Your network is not active.');
    END IF;

    v_name := public.network_display_name(v_req.commander_user_id);

    IF NOT p_approve THEN
        UPDATE public.network_join_requests SET status = 'declined', decided_at = now() WHERE id = v_req.id;
        PERFORM public.notify_user(v_req.driver_user_id, 'grid',
            v_name || ' isn''t taking you on right now',
            'You can ask another network from the Networks screen.');
        RETURN jsonb_build_object('success', true, 'status', 'declined');
    END IF;

    SELECT id, name, recruited_by_commander_user_id, recruited_at INTO v_driver
    FROM public.drivers WHERE id = v_req.driver_id FOR UPDATE;

    -- Re-check the cooldown at decision time: the driver may have been
    -- moved by another path since asking.
    IF v_driver.recruited_by_commander_user_id IS NOT NULL
       AND v_driver.recruited_by_commander_user_id <> v_req.commander_user_id
       AND v_driver.recruited_at IS NOT NULL
       AND v_driver.recruited_at > now() - interval '30 days' THEN
        UPDATE public.network_join_requests SET status = 'cancelled', decided_at = now() WHERE id = v_req.id;
        RETURN jsonb_build_object('success', false, 'error', 'This driver joined another network recently and can''t move yet.');
    END IF;

    UPDATE public.drivers
    SET recruited_by_commander_user_id = v_req.commander_user_id,
        recruited_at = now()
    WHERE id = v_driver.id;

    UPDATE public.network_join_requests SET status = 'approved', decided_at = now() WHERE id = v_req.id;

    PERFORM public.notify_user(v_req.driver_user_id, 'grid',
        'You''re in ' || v_name,
        'You now drive under ' || v_name || '. Nothing changes in how you''re paid per ride.');

    IF v_driver.recruited_by_commander_user_id IS NOT NULL
       AND v_driver.recruited_by_commander_user_id <> v_req.commander_user_id THEN
        PERFORM public.notify_user(v_driver.recruited_by_commander_user_id, 'grid',
            'A driver left your network',
            COALESCE(v_driver.name, 'A driver') || ' moved to another network. You stop earning on their rides from now on.');
    END IF;

    RETURN jsonb_build_object('success', true, 'status', 'approved');
END;
$function$;
REVOKE ALL ON FUNCTION public.decide_network_join(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_network_join(uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
