-- G-TAXI LOGISTICS MASTER SCHEMA (Phase 17 Hardening)
-- This creates the missing infrastructure for Merchant & Admin controls.

-- 1. ORDERS TABLE
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID REFERENCES rides(id) ON DELETE CASCADE,
    rider_id UUID NOT NULL REFERENCES auth.users(id),
    merchant_id UUID, -- For direct store assignment
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'awaiting_approval', 'picked_up', 'delivered', 'cancelled')),
    total_cents INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. ORDER ITEMS
CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    product_name TEXT,
    quantity INTEGER DEFAULT 1,
    unit_price_cents INTEGER DEFAULT 0
);

-- 3. MERCHANT INTAKE LOGS (Photo Proof Storage)
CREATE TABLE IF NOT EXISTS public.merchant_intake_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL,
    items JSONB NOT NULL,
    photo_urls TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. HANDOFF PINS (Security Layer)
CREATE TABLE IF NOT EXISTS public.order_handoff_pins (
    order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    pickup_pin TEXT NOT NULL DEFAULT (floor(random()*9000 + 1000)::text),
    merchant_pin TEXT NOT NULL DEFAULT (floor(random()*9000 + 1000)::text),
    delivery_pin TEXT NOT NULL DEFAULT (floor(random()*9000 + 1000)::text)
);

-- ENABLE REALTIME
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE orders, merchant_intake_logs;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS POLICIES
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_intake_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Riders see own orders" ON public.orders;
CREATE POLICY "Riders see own orders" ON public.orders FOR SELECT USING (rider_id = auth.uid());
DROP POLICY IF EXISTS "Admins see all orders" ON public.orders;
CREATE POLICY "Admins see all orders" ON public.orders FOR ALL TO authenticated USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
) WITH CHECK (true);

-- Ensure ride_events is ready for Admin
DROP POLICY IF EXISTS "Admins see all events" ON public.ride_events;
CREATE POLICY "Admins see all events" ON public.ride_events FOR SELECT TO authenticated USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);
