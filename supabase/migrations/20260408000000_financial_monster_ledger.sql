-- 20260408000000_financial_monster_ledger.sql
-- ENGINEERING THE FINANCIAL SOURCE OF TRUTH (MONSTER TIER)

-- 1. Create Platform Revenue Logs (The Absolute Audit Trail)
CREATE TABLE IF NOT EXISTS public.platform_revenue_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID REFERENCES public.rides(id) ON DELETE SET NULL,
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    merchant_id UUID REFERENCES public.merchants(id) ON DELETE SET NULL,
    gross_amount_cents INTEGER NOT NULL,
    platform_fee_cents INTEGER NOT NULL,
    driver_payout_cents INTEGER NOT NULL,
    merchant_split_cents INTEGER DEFAULT 0, -- For B2B referral kickbacks
    currency TEXT DEFAULT 'TTD',
    created_at TIMESTAMPTZ DEFAULT now(),
    metadata JSONB DEFAULT '{}'
);

-- Enable RLS (Admin Only)
ALTER TABLE public.platform_revenue_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all revenue logs" 
ON public.platform_revenue_logs 
FOR SELECT 
USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- 2. Create Merchant Monthly Audit View
-- This allows merchants to see exactly what they owe/earn per month
CREATE OR REPLACE VIEW public.v_merchant_revenue_summary AS
SELECT 
    merchant_id,
    date_trunc('month', created_at) as month,
    COUNT(id) as total_transactions,
    SUM(gross_amount_cents) as total_gross_cents,
    SUM(platform_fee_cents) as total_platform_commission_cents,
    SUM(merchant_split_cents) as total_merchant_earnings_cents
FROM public.platform_revenue_logs
GROUP BY merchant_id, date_trunc('month', created_at);

-- 3. Function to capture revenue split (To be called by complete_ride edge function)
CREATE OR REPLACE FUNCTION public.log_platform_revenue(
    p_ride_id UUID,
    p_order_id UUID,
    p_merchant_id UUID,
    p_gross_cents INTEGER,
    p_payout_cents INTEGER,
    p_merchant_earnings_cents INTEGER DEFAULT 0
) RETURNS VOID AS $$
DECLARE
    v_platform_fee INTEGER;
BEGIN
    v_platform_fee := p_gross_cents - p_payout_cents - p_merchant_earnings_cents;
    
    INSERT INTO public.platform_revenue_logs (
        ride_id, order_id, merchant_id, gross_amount_cents, platform_fee_cents, driver_payout_cents, merchant_split_cents
    ) VALUES (
        p_ride_id, p_order_id, p_merchant_id, p_gross_cents, v_platform_fee, p_payout_cents, p_merchant_earnings_cents
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant access to service role for edge functions
GRANT EXECUTE ON FUNCTION public.log_platform_revenue TO service_role;
