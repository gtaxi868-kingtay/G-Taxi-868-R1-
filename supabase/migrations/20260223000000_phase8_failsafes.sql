BEGIN;

-- 1. Feature Flags Table
CREATE TABLE IF NOT EXISTS public.system_feature_flags (
    id TEXT PRIMARY KEY, -- e.g. 'grocery_module', 'laundry_module'
    is_active BOOLEAN DEFAULT false,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.system_feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read feature flags" ON public.system_feature_flags FOR SELECT USING (true);
CREATE POLICY "Service role can manage feature flags" ON public.system_feature_flags FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Insert Default Flags
INSERT INTO public.system_feature_flags (id, is_active, description) VALUES 
('grocery_module', false, 'Enable grocery delivery platform'),
('laundry_module', false, 'Enable laundry delivery platform'),
('opt_in_ai_routing', true, 'Enable smart ATM/POI popups on routes')
ON CONFLICT (id) DO NOTHING;

-- 2. Waypoints Support in Rides
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS waypoints JSONB DEFAULT '[]'::jsonb;

-- 3. Cancellation Audit Support
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS audit_needed_at TIMESTAMPTZ;
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS platform_leakage_detected BOOLEAN DEFAULT false;

-- 4. Update transaction types
ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_transaction_type_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_transaction_type_check 
    CHECK (transaction_type IN ('topup', 'ride_payment', 'refund', 'bonus', 'driver_payout', 'tip', 'commission_fee', 'cancellation_fee', 'leakage_fine', 'debt_recovery'));

COMMIT;
