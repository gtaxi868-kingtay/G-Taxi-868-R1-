-- Two independent low-risk cleanups closed from the outstanding-findings
-- list, both verifiable without any user input.

-- 1. auto_insert_ledger_on_completion (trigger on rides, fires on any
-- transition to status='completed') did NEW.total_fare_cents / 100.0
-- with no NULL guard -- if a ride ever reached 'completed' with a NULL
-- fare, the trigger threw and the completion itself failed. Not hit by
-- complete_ride's real flow (always sets a fare), but a real landmine
-- for any other path. Fixed to skip the ledger insert (leaving
-- ledger_recorded=false, backfillable) instead of crashing the ride's
-- own completion. Dry-run verified live: a NULL-fare completion no
-- longer throws.
CREATE OR REPLACE FUNCTION public.auto_insert_ledger_on_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_provider TEXT;
BEGIN
    IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.ledger_recorded IS DISTINCT FROM TRUE THEN
        IF NEW.total_fare_cents IS NULL THEN
            RETURN NEW;
        END IF;
        v_provider := CASE NEW.payment_method
            WHEN 'wallet' THEN 'wallet'
            WHEN 'card'   THEN 'stripe'
            WHEN 'cash'   THEN 'cash'
            WHEN 'mixed'  THEN 'wallet'
            ELSE 'wallet'
        END;
        INSERT INTO public.payment_ledger
            (ride_id, user_id, amount, currency, status, provider, created_at)
        VALUES
            (NEW.id, NEW.rider_id, (NEW.total_fare_cents / 100.0), 'TTD', 'captured', v_provider, NOW());
        NEW.ledger_recorded := TRUE;
    END IF;
    RETURN NEW;
END;
$function$;

-- 2. Follow-up to the 2026-08-15 RPC-grant audit's "not urgent" hygiene
-- items. Verified real call sites before touching anything:
--   - resolve_tag_to_profile: called only from nfc_event_handler,
--     nfc_restore_session, process_nfc_settlement -- all via service-role
--     admin clients, never from a client app.
--   - verify_kiosk_origin: called only from create_ride/index.ts via
--     adminClient (service_role).
--   - check_escape_lane_fare_freshness, lock_escape_group_pricing,
--     sweep_driver_safety: confirmed via cron.job -- run only as
--     pg_cron's scheduling role, need no client-facing grant at all.
-- calculate_escape_group_price/calculate_escape_sell_price/
-- scout_record_completion were deliberately left untouched -- they have
-- real internal Postgres-function callers (secure_escape_booking,
-- sync_escape_package_sell_price, the scout trigger functions) whose own
-- calling-role context wasn't fully verified; revoking risked breaking a
-- working feature for a low-severity (no money movement, no privilege
-- escalation) hygiene item.
REVOKE EXECUTE ON FUNCTION public.resolve_tag_to_profile(text) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.verify_kiosk_origin(uuid, uuid, double precision, double precision) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.check_escape_lane_fare_freshness() FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.lock_escape_group_pricing() FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.sweep_driver_safety() FROM PUBLIC, authenticated, anon;

GRANT EXECUTE ON FUNCTION public.resolve_tag_to_profile(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_kiosk_origin(uuid, uuid, double precision, double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_escape_lane_fare_freshness() TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.lock_escape_group_pricing() TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.sweep_driver_safety() TO service_role, postgres;
