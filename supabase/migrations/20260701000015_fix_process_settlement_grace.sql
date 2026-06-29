-- Fix process_settlement_grace(): it 400s every 5 minutes (cron process-settlement-grace)
-- with SQLSTATE 42703 "column status does not exist".
--
-- Cause: its second statement updates ecosystem_pool_ledger SET status='settled',
-- settled_at=now() WHERE status='pending' AND settle_at<=now() — but the live
-- ecosystem_pool_ledger table has NONE of those columns. It tracks distribution via
-- distributed_cents/distributed_at; the status/settle_at model came from a superseded
-- design (only an archived index ever referenced it) and pool distribution is handled
-- by record_pool_entry / post_reserve_contribution / pool_distributions, not here.
--
-- The split_sessions expiry (first statement) is valid and useful, so we keep it and
-- drop the broken pool UPDATE. CREATE OR REPLACE preserves existing grants.

CREATE OR REPLACE FUNCTION public.process_settlement_grace()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_expired_sessions int;
BEGIN
    UPDATE public.split_sessions
       SET status = 'expired'
     WHERE status = 'collecting' AND expires_at < now();
    GET DIAGNOSTICS v_expired_sessions = ROW_COUNT;

    RETURN jsonb_build_object(
        'expired_split_sessions', v_expired_sessions,
        'swept_at', now()
    );
END;
$$;
