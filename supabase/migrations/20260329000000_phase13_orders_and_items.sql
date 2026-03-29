-- Phase 13: Orders & Order Items for Grocery and Laundry verticals
-- These tables back the GroceryCartScreen and LaundryEstimatorScreen

CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    merchant_id UUID REFERENCES public.merchants(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    -- 'pending', 'picked_up', 'processing', 'ready', 'delivered', 'cancelled'
    total_cents INTEGER NOT NULL DEFAULT 0,
    delivery_method TEXT DEFAULT 'courier',
    -- 'courier', 'to_ride', 'laundry_pickup'
    ride_id UUID REFERENCES public.rides(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price_cents INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- Riders can manage their own orders
CREATE POLICY "Riders can view their own orders"
    ON public.orders FOR SELECT
    USING (auth.uid() = rider_id);

CREATE POLICY "Riders can create orders"
    ON public.orders FOR INSERT
    WITH CHECK (auth.uid() = rider_id);

CREATE POLICY "Riders can view their own order items"
    ON public.order_items FOR SELECT
    USING (
        order_id IN (
            SELECT id FROM public.orders WHERE rider_id = auth.uid()
        )
    );

CREATE POLICY "Riders can insert order items for their orders"
    ON public.order_items FOR INSERT
    WITH CHECK (
        order_id IN (
            SELECT id FROM public.orders WHERE rider_id = auth.uid()
        )
    );

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_orders_updated_at
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION update_orders_updated_at();
