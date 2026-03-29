-- G-TAXI TRUST & LOGIC ENGINE (Phase 11)
-- 1. PIN System (Rider -> Driver -> Merchant)
-- 2. Merchant Intake & Rider Approval
-- 3. Favored Driver Logic
-- 4. Driver Debt Management ($600 Limit)

BEGIN;

-- ==========================================
-- 1. HANDOFF PINS
-- ==========================================
CREATE TABLE IF NOT EXISTS public.order_handoff_pins (
    order_id UUID PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
    pickup_pin TEXT NOT NULL, -- Rider -> Driver
    merchant_pin TEXT NOT NULL, -- Driver -> Merchant
    delivery_pin TEXT NOT NULL, -- Driver -> Final Destination
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Function to generate random 4-digit PIN
CREATE OR REPLACE FUNCTION generate_4_digit_pin() RETURNS TEXT AS $$
BEGIN
    RETURN lpad(floor(random() * 10000)::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate PINs for new orders
CREATE OR REPLACE FUNCTION handle_new_order_pins() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.order_handoff_pins (order_id, pickup_pin, merchant_pin, delivery_pin)
    VALUES (NEW.id, generate_4_digit_pin(), generate_4_digit_pin(), generate_4_digit_pin());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_generate_order_pins
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION handle_new_order_pins();

-- ==========================================
-- 2. MERCHANT INTAKE & LOGS
-- ==========================================
CREATE TABLE IF NOT EXISTS public.merchant_intake_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
    items JSONB NOT NULL, -- e.g. {"shirts": 3, "pants": 2}
    photo_urls TEXT[], 
    merchant_id UUID REFERENCES public.merchants(id),
    rider_approved BOOLEAN DEFAULT FALSE,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- 3. DRIVER PREFERENCES (Favored Driver)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.user_preferred_drivers (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    driver_id UUID REFERENCES public.drivers(id) ON DELETE CASCADE,
    rank INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, driver_id)
);

-- ==========================================
-- 4. DEBT MANAGEMENT ($600 Limit)
-- ==========================================
-- Drivers can only go online if they owe less than $600 TTD in cash commission
CREATE OR REPLACE FUNCTION check_driver_debt_limit(p_driver_id UUID) RETURNS BOOLEAN AS $$
DECLARE
    v_total_owed INTEGER;
BEGIN
    -- Sum of commissions from cash rides that haven't been settled
    SELECT COALESCE(SUM(amount), 0) INTO v_total_owed
    FROM public.wallet_transactions
    WHERE user_id = p_driver_id 
      AND transaction_type = 'commission_debt' 
      AND status = 'pending';

    -- Debt limit is 60000 cents ($600.00 TTD)
    RETURN v_total_owed > -60000; 
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to prevent "Online" status if debt is exceeded
CREATE OR REPLACE FUNCTION enforce_driver_debt_limit() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_online = true AND NOT check_driver_debt_limit(NEW.id) THEN
        RAISE EXCEPTION 'Debt limit exceeded. Please settle outstanding commission ($600 TTD limit).';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Assuming there is a triggers check on drivers.is_online
-- CREATE TRIGGER trigger_enforce_debt
-- BEFORE UPDATE OF is_online ON public.drivers
-- FOR EACH ROW WHEN (NEW.is_online = true)
-- EXECUTE FUNCTION enforce_driver_debt_limit();

-- ==========================================
-- 5. RIDERS TABLES UPDATES (Extension)
-- ==========================================
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS rider_notes TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'pending'; 
-- 'pending', 'verified', 'rejected'

COMMIT;
