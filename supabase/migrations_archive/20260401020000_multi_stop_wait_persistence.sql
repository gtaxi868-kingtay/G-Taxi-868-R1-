-- Migration: 20260401020000_multi_stop_wait_persistence.sql
-- Phase 15 Fix 15.1 — Add real-time persistence for individual ride stops.

ALTER TABLE public.ride_stops 
ADD COLUMN IF NOT EXISTS total_wait_seconds INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_wait_ping_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS is_waiting BOOLEAN DEFAULT FALSE;

-- Trigger Function: Auto-calculate wait fee during a ping
CREATE OR REPLACE FUNCTION public.increment_stop_wait_time(p_stop_id UUID)
RETURNS VOID AS $$
DECLARE
    v_now TIMESTAMPTZ := now();
    v_last_ping TIMESTAMPTZ;
    v_delta_seconds INTEGER;
    v_is_waiting BOOLEAN;
BEGIN
    SELECT last_wait_ping_at, is_waiting INTO v_last_ping, v_is_waiting
    FROM public.ride_stops
    WHERE id = p_stop_id;

    IF v_is_waiting AND v_last_ping IS NOT NULL THEN
        -- Calculate seconds since last ping (max 60 to prevent exploit/weird jumps)
        v_delta_seconds := LEAST(60, EXTRACT(EPOCH FROM (v_now - v_last_ping))::INTEGER);
        
        IF v_delta_seconds > 0 THEN
            UPDATE public.ride_stops
            SET 
                total_wait_seconds = total_wait_seconds + v_delta_seconds,
                last_wait_ping_at = v_now,
                -- 90 cents per minute = 1.5 cents per second
                wait_fee_cents = floor((total_wait_seconds + v_delta_seconds) * 1.5)
            WHERE id = p_stop_id;

            -- Sync to parent ride ledger
            UPDATE public.rides
            SET stop_wait_seconds = COALESCE(stop_wait_seconds, 0) + v_delta_seconds
            WHERE id = (SELECT ride_id FROM public.ride_stops WHERE id = p_stop_id);
        END IF;
    ELSE
        -- First ping or restart
        UPDATE public.ride_stops
        SET 
            last_wait_ping_at = v_now,
            is_waiting = TRUE
        WHERE id = p_stop_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.increment_stop_wait_time IS 'Increments the wait timer for a specific stop and updates the fee in real-time.';
