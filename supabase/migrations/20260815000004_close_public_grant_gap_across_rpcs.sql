-- Follow-up to 20260815000003, which fixed the PUBLIC-grant regression on
-- compute_ride_split/settle_cash_ride/process_wallet_payment_hardened.
-- User asked to check every other RPC for the same gap. A background audit
-- cross-referenced all 74 SECURITY DEFINER functions in `public` that
-- currently have authenticated/anon/PUBLIC EXECUTE against actual call
-- sites in supabase/functions/**/*.ts and apps/**/*.ts, and read each
-- suspect function's body via pg_get_functiondef to check for an internal
-- auth.uid()-based ownership/role check. Verdict on the other ~69: legitimate
-- client-facing RPCs with correct internal checks, RETURNS trigger functions
-- (inert outside trigger context regardless of grant), or low-sensitivity
-- read-only/cron helpers not worth urgent action. Five were real bugs.
--
-- Same root cause as 20260815000003 for four of the five: a prior
-- DROP+CREATE (or plain CREATE) never re-revoked the PUBLIC-EXECUTE
-- default Postgres attaches to every newly created function. These four
-- were never meant to be called by anything except an edge function
-- running as service_role — they do zero internal caller-identity
-- verification, so a client-reachable grant means full impersonation:
--
--   increment_referral_reward_rides(uuid,uuid)   — pays a driver-onboard
--     reward from the reserve fund via spend_from_reserve(); callable
--     directly with an arbitrary (rider_id, driver_id) pair to fabricate
--     rewards for rides that never happened.
--   increment_rider_referral_reward(uuid)         — same pattern, rider-
--     onboard reward from the reserve fund.
--   register_unified_identity_admin(uuid,text,text,text,jsonb) — despite
--     the _admin name, meant only for nfc_event_handler's service-role
--     client after a REAL NFC tap; callable directly to bind an arbitrary
--     tag to an arbitrary victim profile with no physical tap involved.
--   backfill_unified_identities()                 — platform-wide bulk
--     maintenance script; not a data-corruption risk on its own
--     (ON CONFLICT DO NOTHING) but a resource-abuse vector with zero
--     reason to be client-reachable.
--
-- These four get the identical REVOKE/GRANT treatment as 20260815000003 —
-- no logic change needed, they were only ever supposed to run as
-- service_role.
REVOKE EXECUTE ON FUNCTION public.increment_referral_reward_rides(uuid, uuid) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.increment_rider_referral_reward(uuid) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.register_unified_identity_admin(uuid, text, text, text, jsonb) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.backfill_unified_identities() FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.increment_referral_reward_rides(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_rider_referral_reward(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_unified_identity_admin(uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.backfill_unified_identities() TO service_role;

-- The fifth, increment_stop_wait_time(uuid), is a DIFFERENT class of bug —
-- it genuinely IS called directly by the driver app on every wait-time
-- ping (apps/driver/src/hooks/useStopWaitTimer.ts), so REVOKE is not an
-- option. It simply never had an internal caller-identity check at all:
-- any authenticated user could pass any p_stop_id and inflate
-- wait_fee_cents / stop_wait_seconds on a ride they had no part in,
-- directly manipulating what a rider gets charged. Fixed by adding the
-- exact ownership-check pattern already used correctly elsewhere in this
-- codebase (mark_ride_safe): resolve the ride's assigned driver via
-- drivers.user_id and require it to equal auth.uid(). Live-verified via
-- real HTTP calls against the deployed PostgREST endpoint with two real
-- throwaway auth accounts: a non-assigned "attacker" account gets
-- rejected with "Not authorized: caller is not the assigned driver"
-- (P0001), the real assigned driver succeeds (204). No grant change
-- needed here — it was already, correctly, authenticated-only; the gap
-- was inside the function body, not in GRANT state.
CREATE OR REPLACE FUNCTION public.increment_stop_wait_time(p_stop_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_now TIMESTAMPTZ := now();
    v_last_ping TIMESTAMPTZ;
    v_delta_seconds INTEGER;
    v_is_waiting BOOLEAN;
    v_ride_id UUID;
    v_driver_uid UUID;
BEGIN
    SELECT rs.last_wait_ping_at, rs.is_waiting, rs.ride_id
      INTO v_last_ping, v_is_waiting, v_ride_id
    FROM public.ride_stops rs
    WHERE rs.id = p_stop_id;

    IF v_ride_id IS NULL THEN
        RAISE EXCEPTION 'Stop not found';
    END IF;

    SELECT d.user_id INTO v_driver_uid
    FROM public.rides r JOIN public.drivers d ON d.id = r.driver_id
    WHERE r.id = v_ride_id;

    IF v_driver_uid IS NULL OR v_driver_uid <> auth.uid() THEN
        RAISE EXCEPTION 'Not authorized: caller is not the assigned driver';
    END IF;

    IF v_is_waiting AND v_last_ping IS NOT NULL THEN
        v_delta_seconds := LEAST(60, EXTRACT(EPOCH FROM (v_now - v_last_ping))::INTEGER);

        IF v_delta_seconds > 0 THEN
            UPDATE public.ride_stops
            SET
                total_wait_seconds = total_wait_seconds + v_delta_seconds,
                last_wait_ping_at = v_now,
                wait_fee_cents = floor((total_wait_seconds + v_delta_seconds) * 2.5)
            WHERE id = p_stop_id;

            UPDATE public.rides
            SET stop_wait_seconds = COALESCE(stop_wait_seconds, 0) + v_delta_seconds
            WHERE id = v_ride_id;
        END IF;
    ELSE
        UPDATE public.ride_stops
        SET
            last_wait_ping_at = v_now,
            is_waiting = TRUE
        WHERE id = p_stop_id;
    END IF;
END;
$function$;

-- request_cash_withdrawal was checked specifically (same p_user_id /
-- p_wallet_user_id shape that caused the earlier process_payout_request
-- bug) and confirmed ALREADY correct: p_user_id must equal auth.uid(),
-- and p_wallet_user_id must either equal auth.uid() or resolve via
-- EXISTS (SELECT 1 FROM drivers d WHERE d.id = p_wallet_user_id AND
-- d.user_id = auth.uid()). No change needed, no-op left out of this file.
--
-- All 12 admin_* functions were checked and confirmed to have a real
-- profiles.role = 'admin' check against auth.uid() before doing anything.
-- No change needed.
