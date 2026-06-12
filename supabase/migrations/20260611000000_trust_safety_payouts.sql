-- MIGRATION: 20260611000000_trust_safety_payouts.sql
-- TRUST & SAFETY HARDENING:
--   1. support_tickets — rider/driver dispute + refund request pipeline
--   2. drivers.rating — real averaged rating maintained by trigger on ratings
--   3. drivers.bank_details — payout destination collected in the driver app
--   4. request_driver_payout() — server-side payout request with balance check
--   5. process_payout_request() — atomic admin approval with FOR UPDATE wallet debit

BEGIN;

-- ============================================================
-- 1. SUPPORT TICKETS (disputes / refund requests / complaints)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ride_id UUID REFERENCES public.rides(id) ON DELETE SET NULL,
    category TEXT NOT NULL CHECK (category IN (
        'refund_request', 'overcharge', 'driver_behavior', 'rider_behavior',
        'lost_item', 'safety', 'app_issue', 'other'
    )),
    description TEXT NOT NULL CHECK (char_length(description) BETWEEN 5 AND 2000),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
        'open', 'in_review', 'resolved', 'rejected'
    )),
    resolution_note TEXT,
    refund_amount_cents INTEGER,
    resolved_by UUID REFERENCES auth.users(id),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON public.support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_ride ON public.support_tickets(ride_id);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

-- Users can see their own tickets (inserts go through the submit_dispute
-- edge function via service role, so no client INSERT policy is granted).
DROP POLICY IF EXISTS "Users view own tickets" ON public.support_tickets;
CREATE POLICY "Users view own tickets" ON public.support_tickets
    FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins full access tickets" ON public.support_tickets;
CREATE POLICY "Admins full access tickets" ON public.support_tickets
    FOR ALL TO authenticated USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
    );

DROP POLICY IF EXISTS "Service role manages tickets" ON public.support_tickets;
CREATE POLICY "Service role manages tickets" ON public.support_tickets
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 2. REAL DRIVER RATINGS
-- ============================================================

ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS rating NUMERIC(3,2);
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS rating_count INTEGER DEFAULT 0;

CREATE OR REPLACE FUNCTION public.refresh_driver_rating() RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.drivers d
    SET rating = sub.avg_rating,
        rating_count = sub.cnt,
        updated_at = now()
    FROM (
        SELECT ROUND(AVG(rating)::numeric, 2) AS avg_rating, COUNT(*) AS cnt
        FROM public.ratings
        WHERE driver_id = NEW.driver_id
    ) sub
    WHERE d.id = NEW.driver_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_refresh_driver_rating ON public.ratings;
CREATE TRIGGER trg_refresh_driver_rating
    AFTER INSERT OR UPDATE ON public.ratings
    FOR EACH ROW EXECUTE FUNCTION public.refresh_driver_rating();

-- Backfill existing ratings into driver profiles
UPDATE public.drivers d
SET rating = sub.avg_rating,
    rating_count = sub.cnt
FROM (
    SELECT driver_id, ROUND(AVG(rating)::numeric, 2) AS avg_rating, COUNT(*) AS cnt
    FROM public.ratings
    GROUP BY driver_id
) sub
WHERE d.id = sub.driver_id;

-- ============================================================
-- 3. DRIVER BANK DETAILS (payout destination)
-- ============================================================

ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS bank_details JSONB;

-- ============================================================
-- 4. PAYOUT REQUEST (server-side, balance-checked)
-- ============================================================

-- Requests now flow through the request_payout edge function (service role),
-- which resolves the driver from the JWT. Remove the direct client INSERT path
-- so amount_cents can never be client-fabricated without a balance check.
DROP POLICY IF EXISTS "Drivers can create payout requests" ON public.payout_requests;

CREATE OR REPLACE FUNCTION public.request_driver_payout(
    p_driver_id UUID,
    p_amount_cents INTEGER
) RETURNS UUID AS $$
DECLARE
    v_balance INTEGER;
    v_bank JSONB;
    v_pending INTEGER;
    v_request_id UUID;
BEGIN
    IF p_amount_cents IS NULL OR p_amount_cents < 2000 THEN
        RAISE EXCEPTION 'MINIMUM_PAYOUT'; -- $20 TTD minimum
    END IF;

    -- Serialize per-driver payout activity
    PERFORM 1 FROM public.drivers WHERE id = p_driver_id FOR UPDATE;

    SELECT bank_details INTO v_bank FROM public.drivers WHERE id = p_driver_id;
    IF v_bank IS NULL OR v_bank->>'account_number' IS NULL OR v_bank->>'bank_name' IS NULL THEN
        RAISE EXCEPTION 'BANK_DETAILS_MISSING';
    END IF;

    SELECT COUNT(*) INTO v_pending
    FROM public.payout_requests
    WHERE driver_id = p_driver_id AND status IN ('pending', 'processing');
    IF v_pending > 0 THEN
        RAISE EXCEPTION 'PAYOUT_ALREADY_PENDING';
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.wallet_transactions
    WHERE user_id = p_driver_id AND status = 'completed';
    IF v_balance < p_amount_cents THEN
        RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
    END IF;

    INSERT INTO public.payout_requests (driver_id, amount_cents, status, bank_details)
    VALUES (p_driver_id, p_amount_cents, 'pending', v_bank)
    RETURNING id INTO v_request_id;

    RETURN v_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION public.request_driver_payout(UUID, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.request_driver_payout(UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.request_driver_payout(UUID, INTEGER) TO service_role;

-- ============================================================
-- 5. PAYOUT PROCESSING (admin approval — atomic wallet debit)
-- ============================================================

CREATE OR REPLACE FUNCTION public.process_payout_request(
    p_request_id UUID,
    p_action TEXT,            -- 'approve' | 'reject'
    p_admin_id UUID,
    p_reason TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    v_req RECORD;
    v_balance INTEGER;
BEGIN
    SELECT * INTO v_req FROM public.payout_requests
    WHERE id = p_request_id FOR UPDATE;

    IF v_req IS NULL THEN
        RAISE EXCEPTION 'REQUEST_NOT_FOUND';
    END IF;
    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'REQUEST_NOT_PENDING';
    END IF;

    IF p_action = 'reject' THEN
        UPDATE public.payout_requests
        SET status = 'rejected',
            rejection_reason = COALESCE(p_reason, 'Rejected by admin'),
            processed_at = now(),
            updated_at = now()
        WHERE id = p_request_id;
        RETURN TRUE;
    END IF;

    IF p_action <> 'approve' THEN
        RAISE EXCEPTION 'INVALID_ACTION';
    END IF;

    -- Lock the driver row, then re-verify balance before debiting
    PERFORM 1 FROM public.drivers WHERE id = v_req.driver_id FOR UPDATE;

    SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.wallet_transactions
    WHERE user_id = v_req.driver_id AND status = 'completed';
    IF v_balance < v_req.amount_cents THEN
        UPDATE public.payout_requests
        SET status = 'rejected',
            rejection_reason = 'Insufficient balance at processing time',
            processed_at = now(),
            updated_at = now()
        WHERE id = p_request_id;
        RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
    END IF;

    INSERT INTO public.wallet_transactions (user_id, ride_id, amount, transaction_type, description, reference_id, status)
    VALUES (
        v_req.driver_id, NULL, -v_req.amount_cents, 'driver_payout',
        'Payout to ' || COALESCE(v_req.bank_details->>'bank_name', 'bank'),
        'payout:' || p_request_id::text, 'completed'
    );

    UPDATE public.payout_requests
    SET status = 'completed',
        processed_at = now(),
        updated_at = now()
    WHERE id = p_request_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION public.process_payout_request(UUID, TEXT, UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.process_payout_request(UUID, TEXT, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_payout_request(UUID, TEXT, UUID, TEXT) TO service_role;

COMMIT;
