-- ═══════════════════════════════════════════════════════════════════
-- PLATFORM CRON SECRET: READ FROM VAULT, NOT A GUC THAT IS ALWAYS NULL
-- (2026-07-31)
--
-- Background: several SQL call sites need to authenticate an outbound
-- net.http_post to an edge function, and were written as:
--
--     current_setting('app.settings.cron_secret', true)
--
-- That GUC has never been set in this project — it reads NULL every
-- time (verified live). Every such call therefore sent
-- `x-cron-secret: null` and was rejected 401 by the target function.
-- The historical workaround was to patch the literal secret directly
-- into live function bodies, which works but puts a live credential in
-- the database source where it can leak into any pg_get_functiondef
-- dump, and must never be committed to git.
--
-- Supabase Vault is already installed on this project and already
-- holds other secrets (UPSTASH_REDIS_REST_URL/TOKEN,
-- WIPAY_ACCOUNT_NUMBER, WIPAY_ENVIRONMENT), so this is the pattern the
-- project already uses — it just was not used here.
--
-- Verified: a SECURITY DEFINER function CAN read vault.decrypted_secrets
-- (probe returned "vault readable from SECURITY DEFINER").
--
-- This adds one resolver used by every call site, so there is a single
-- place to fix if the mechanism ever changes again. It prefers Vault
-- and falls back to the old GUC, so it is safe to apply before the
-- secret exists — behaviour is simply unchanged until then.
--
-- ─── REMAINING MANUAL STEP (cannot be done from source control) ──────
-- The secret value itself must be put into Vault once. It must match
-- the PLATFORM_CRON_SECRET already configured in the Edge Function
-- secrets, so that notify_admins accepts the call:
--
--   SELECT vault.create_secret('<the-existing-PLATFORM_CRON_SECRET>',
--                              'PLATFORM_CRON_SECRET',
--                              'Shared secret for pg_cron -> edge function calls');
--
-- Deliberately NOT included as a literal here: this file is tracked in
-- git and must never contain a live credential.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.platform_cron_secret()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
    SELECT COALESCE(
        (SELECT decrypted_secret
           FROM vault.decrypted_secrets
          WHERE name = 'PLATFORM_CRON_SECRET'
          LIMIT 1),
        current_setting('app.settings.cron_secret', true)
    );
$$;

COMMENT ON FUNCTION public.platform_cron_secret() IS
    'Resolves the shared secret used to authenticate SQL -> edge function calls. Reads Supabase Vault first, falls back to the (historically always-NULL) app.settings.cron_secret GUC. Never inline the secret at a call site — call this instead.';

-- Only the DB itself needs this; no client role should ever read it.
REVOKE ALL ON FUNCTION public.platform_cron_secret() FROM PUBLIC, anon, authenticated;

-- ─── Rewire the two real-time admin alert call sites ─────────────────
-- (bodies otherwise identical to 20260727060000; only the header value
-- changes from the dead GUC to the resolver above)

CREATE OR REPLACE FUNCTION public.notify_admins_new_garage_request()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_driver_name text;
BEGIN
    SELECT name INTO v_driver_name FROM public.drivers WHERE id = NEW.driver_id;
    PERFORM net.http_post(
        url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/notify_admins',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-secret', public.platform_cron_secret()
        ),
        body := jsonb_build_object(
            'title', 'G Garage: new vehicle request',
            'body', format('%s requested a %s (%s) — review in G Garage.',
                           COALESCE(v_driver_name, 'A driver'), NEW.vehicle_class_key, NEW.source),
            'data', jsonb_build_object('request_id', NEW.id)
        )
    );
    RETURN NEW;
END;
$$;

-- ─── Same rewire for the G-Escape tipping-point alert ────────────────
-- Body is byte-identical to 20260727060000 apart from the header value.

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
    v_real_deadline timestamptz;
    v_proposal_id uuid;
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
    -- Real deadline (departure minus 24h, clamped to at least 1h from
    -- now) now drives BOTH the safety-net loop below AND expires_at —
    -- one real number, not a generic default that meant nothing here.
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

            v_real_deadline := GREATEST(v_block.departure_time - interval '24 hours', now() + interval '1 hour');

            INSERT INTO public.g_proposed_actions
                (department, action_type, title, reasoning, category, amount_cents, payload, expires_at)
            VALUES (
                'ops', 'escape_confirm_group',
                format('Release G-Escape group: %s (%s guests)', COALESCE(v_package_name, 'Package'), v_guest_total),
                format('Flight block hit its tipping point (%s/%s seats) and its hold deadline has passed. Confirming releases the group to the airline, hotel, and transfer drivers, and captures the platform margin. Auto-releases on its own if seats fill completely or departure (%s) gets within 24 hours — this proposal is your window to review first.',
                       v_block.allocated_seats, v_block.tipping_point_seats, v_block.departure_time::text),
                'money', v_margin_cents,
                jsonb_build_object('flight_block_id', v_block.id, 'destination', v_block.destination_name, 'departure_time', v_block.departure_time),
                v_real_deadline
            )
            RETURNING id INTO v_proposal_id;

            -- Real-time push — this is the actual "admin gets notice in
            -- time to make the real booking" wire. Fire-and-forget: a
            -- failed push must never block the sweep itself.
            PERFORM net.http_post(
                url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/notify_admins',
                headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', public.platform_cron_secret()),
                body := jsonb_build_object(
                    'title', 'G-Escape: group ready to book',
                    'body', format('%s — %s guests, departs %s. Book the real flight/hotel now, or it auto-releases in 24h.',
                                    COALESCE(v_package_name, 'Package'), v_guest_total, to_char(v_block.departure_time, 'Mon DD, HH24:MI')),
                    'data', jsonb_build_object('proposal_id', v_proposal_id, 'flight_block_id', v_block.id)
                )
            );
        END IF;
    END LOOP;

    -- ── Safety net: admin hasn't acted and departure is getting close. ──
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
    -- covering it → file the demand case for admin.
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
