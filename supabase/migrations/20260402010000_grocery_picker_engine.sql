-- 🛒 GROCERY PICKER ENGINE EXTENSIONS
-- Enabling item-level status tracking and substitution flows.

-- 1. ADD PICKING STATUS TO ORDER ITEMS
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS picking_status TEXT DEFAULT 'PENDING' CHECK (picking_status IN ('PENDING', 'FOUND', 'OUT', 'SUBSTITUTED'));
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS substituted_with_id UUID REFERENCES products(id);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS photo_url TEXT; -- For photo-proof manifest

-- 2. CREATE SUBSTITUTION LOG
CREATE TABLE IF NOT EXISTS order_substitutions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    original_item_id UUID REFERENCES order_items(id),
    suggested_product_id UUID REFERENCES products(id),
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. RLS FOR PICKING
-- Merchants can write to order_items for orders they own
CREATE POLICY "Merchants can update own order items" ON order_items
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM orders 
            WHERE orders.id = order_items.order_id 
            AND orders.merchant_id = (SELECT merchant_id FROM profiles WHERE id = auth.uid())
        )
    );
