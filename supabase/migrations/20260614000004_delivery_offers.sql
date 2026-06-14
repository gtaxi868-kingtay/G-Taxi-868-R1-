-- delivery_offers table — mirrors ride_offers pattern for food/grocery delivery orders.
-- match_order_delivery inserts a row here so the driver app can subscribe and show
-- DeliveryRequestScreen (the same flow as TripRequestScreen for rides).

CREATE TABLE IF NOT EXISTS delivery_offers (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    driver_id    UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
    expires_at   TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '20 seconds',
    created_at   TIMESTAMPTZ DEFAULT now(),
    UNIQUE (order_id, driver_id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_offers_driver_pending
    ON delivery_offers(driver_id)
    WHERE status = 'pending';

-- RLS: driver can only see their own offers
ALTER TABLE delivery_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "driver sees own delivery offers"
    ON delivery_offers FOR SELECT
    USING (
        driver_id = (
            SELECT id FROM drivers WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "driver updates own delivery offer status"
    ON delivery_offers FOR UPDATE
    USING (
        driver_id = (
            SELECT id FROM drivers WHERE user_id = auth.uid()
        )
    )
    WITH CHECK (status IN ('accepted', 'declined'));

CREATE POLICY "service role manages delivery offers"
    ON delivery_offers FOR ALL
    USING (auth.role() = 'service_role');

-- Add delivery columns to orders if not already present.
-- delivery_driver_id: which driver accepted the delivery offer
-- delivery_status: granular step within the delivery flow
-- delivery_address: where to drop the order (rider's address)
-- delivery_fee_cents: flat fee charged to rider (shown in DeliveryRequestScreen)
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS delivery_driver_id UUID REFERENCES drivers(id),
    ADD COLUMN IF NOT EXISTS delivery_status TEXT
        CHECK (delivery_status IN ('driver_assigned','driver_picked_up','driver_en_route','delivered')),
    ADD COLUMN IF NOT EXISTS delivery_address TEXT,
    ADD COLUMN IF NOT EXISTS delivery_fee_cents INTEGER NOT NULL DEFAULT 2000;

-- RLS: driver can see orders assigned to them for delivery
CREATE POLICY "delivery driver sees own order"
    ON orders FOR SELECT
    USING (
        delivery_driver_id = (SELECT id FROM drivers WHERE user_id = auth.uid())
    );

-- RLS: delivery driver can update status on their assigned order
CREATE POLICY "delivery driver updates own order status"
    ON orders FOR UPDATE
    USING (
        delivery_driver_id = (SELECT id FROM drivers WHERE user_id = auth.uid())
    )
    WITH CHECK (
        delivery_driver_id = (SELECT id FROM drivers WHERE user_id = auth.uid())
    );
