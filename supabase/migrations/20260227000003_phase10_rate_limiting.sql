-- =============================================================================
-- PHASE 10 — RATE LIMITING
-- Migration: 20260227000003_phase10_rate_limiting.sql
-- =============================================================================

BEGIN;

-- =============================================================================
-- PART A1 — Create rate_limit_log table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.rate_limit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL,
    endpoint    TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 1,
    UNIQUE(user_id, endpoint, window_start)
);

ALTER TABLE public.rate_limit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages rate limits" ON public.rate_limit_log;
CREATE POLICY "Service role manages rate limits"
    ON public.rate_limit_log 
    FOR ALL 
    TO service_role
    USING (true) 
    WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_rate_limit_user_endpoint 
    ON public.rate_limit_log(user_id, endpoint, window_start);

-- =============================================================================
-- PART A2 — Create check_rate_limit RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_rate_limit(
    p_user_id   UUID,
    p_endpoint  TEXT,
    p_max_requests INTEGER,
    p_window_seconds INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_window_start TIMESTAMPTZ;
    v_count INTEGER;
BEGIN
    -- Round down to the start of the current window
    v_window_start := date_trunc('second', NOW()) - 
        ((EXTRACT(EPOCH FROM NOW())::INTEGER % p_window_seconds) * INTERVAL '1 second');

    -- Upsert: increment counter for this user/endpoint/window
    INSERT INTO public.rate_limit_log (user_id, endpoint, window_start, request_count)
    VALUES (p_user_id, p_endpoint, v_window_start, 1)
    ON CONFLICT (user_id, endpoint, window_start)
    DO UPDATE SET request_count = rate_limit_log.request_count + 1
    RETURNING request_count INTO v_count;

    -- Return TRUE if within limit, FALSE if exceeded
    RETURN v_count <= p_max_requests;
END;
$$;

-- =============================================================================
-- PART A3 — Create cleanup_rate_limit_log RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_log()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM public.rate_limit_log
    WHERE window_start < NOW() - INTERVAL '1 hour';
END;
$$;

COMMIT;
