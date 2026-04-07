-- Phase 15: B2B Monopoly Architecture (Corporate Billing & API Keys)
-- Extends the platform for Enterprise / Hotel / Franchise scaling.

-- 1. Upgrade Merchants Table for Corporate Billing (Net-30)
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS billing_type TEXT DEFAULT 'credit_card';
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS credit_limit_cents BIGINT DEFAULT 0;
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS current_debt_cents BIGINT DEFAULT 0;

-- 2. Link Corporate Rides to the Merchant Ledger
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS billed_to_merchant_id UUID REFERENCES public.merchants(id) NULL;

-- 3. Create the API Key Vault for Headless B2B Integrations (e.g. KFC POS)
CREATE TABLE IF NOT EXISTS public.merchant_api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID REFERENCES public.merchants(id) NOT NULL,
    hashed_key TEXT UNIQUE NOT NULL,       -- Stored as SHA-256 hash. Never store raw keys.
    prefix TEXT NOT NULL,                  -- Quick reference e.g., 'gtaxi_live_ab3x'
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ NULL
);

-- RLS for API Keys
ALTER TABLE public.merchant_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Merchants can view their own API keys" 
    ON public.merchant_api_keys FOR SELECT 
    USING (auth.uid() = merchant_id);

-- System Service Role has full access (for Edge Functions to verify Keys)
CREATE POLICY "Service Role full access to keys" 
    ON public.merchant_api_keys FOR ALL
    USING (auth.jwt()->>'role' = 'service_role');
