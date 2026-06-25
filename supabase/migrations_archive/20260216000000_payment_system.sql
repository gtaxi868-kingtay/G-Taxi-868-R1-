-- ZERO-DATA-LOSS PAYMENT SYSTEM (Phase 2)
-- 1. Wallet Ledger (Source of Truth)
-- 2. Balance Calculation RPC
-- IDEMPOTENT VERSION

BEGIN;
-- 1. WALLET TRANSACTIONS
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    ride_id UUID REFERENCES public.rides(id), -- Nullable for top-ups
    amount INTEGER NOT NULL, -- Positive (Credit), Negative (Debit)
    currency TEXT DEFAULT 'TTD',
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('topup', 'ride_payment', 'refund', 'bonus', 'driver_payout')),
    description TEXT,
    reference_id TEXT, -- External Stripe ID etc.
    status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
    created_at TIMESTAMPTZ DEFAULT now()
);
-- RLS
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users view own wallet' AND tablename = 'wallet_transactions') THEN
        CREATE POLICY "Users view own wallet" ON public.wallet_transactions FOR SELECT USING (user_id = auth.uid());
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service Role manages wallet' AND tablename = 'wallet_transactions') THEN
        CREATE POLICY "Service Role manages wallet" ON public.wallet_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;
-- Indexes
CREATE INDEX IF NOT EXISTS idx_wallet_user ON public.wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_ride ON public.wallet_transactions(ride_id);
-- 2. BALANCE CALCULATION (RPC)
-- Event Sourcing: Balance = Sum(amount) where status = 'completed'
CREATE OR REPLACE FUNCTION get_wallet_balance(p_user_id UUID) RETURNS INTEGER AS $$
DECLARE
    v_balance INTEGER;
BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM wallet_transactions
    WHERE user_id = p_user_id AND status = 'completed';
    
    RETURN v_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Grant access to authenticated users (to check their own balance)
GRANT EXECUTE ON FUNCTION get_wallet_balance TO authenticated;
GRANT EXECUTE ON FUNCTION get_wallet_balance TO service_role;
-- 3. PROCESS WALLET PAYMENT (RPC)
-- Atomic Transaction: Check Balance -> Insert Debit
CREATE OR REPLACE FUNCTION process_wallet_payment(p_ride_id UUID, p_amount INTEGER) RETURNS BOOLEAN AS $$
DECLARE
    v_rider_id UUID;
    v_balance INTEGER;
BEGIN
    -- Get Rider ID
    SELECT rider_id INTO v_rider_id FROM rides WHERE id = p_ride_id;
    
    -- Check Balance
    v_balance := get_wallet_balance(v_rider_id);
    
    IF v_balance < p_amount THEN
        RETURN FALSE; -- Insufficient Funds
    END IF;
    
    -- Deduct
    INSERT INTO wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
    VALUES (v_rider_id, p_ride_id, -p_amount, 'ride_payment', 'Payment for Ride', 'completed');
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
COMMIT;
