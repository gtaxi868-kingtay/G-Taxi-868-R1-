-- Create revenue_splits table for traceable 81/14/5 settlement
-- Phase 2.1: Hardened Business Logic & Resilience Injection

CREATE TABLE IF NOT EXISTS revenue_splits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id         UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    node_id         UUID REFERENCES kiosk_nodes(id),
    driver_id       UUID REFERENCES profiles(id),
    platform_cut    INTEGER NOT NULL,
    driver_cut      INTEGER NOT NULL,
    merchant_cut    INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','settled','failed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    settled_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_revenue_splits_ride_id ON revenue_splits(ride_id);
CREATE INDEX IF NOT EXISTS idx_revenue_splits_node_id ON revenue_splits(node_id);
CREATE INDEX IF NOT EXISTS idx_revenue_splits_driver_id ON revenue_splits(driver_id);

ALTER TABLE revenue_splits ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='revenue_splits' AND policyname='merchant_select_revenue_splits') THEN
    CREATE POLICY merchant_select_revenue_splits ON revenue_splits
      FOR SELECT USING (node_id IN (SELECT id FROM kiosk_nodes WHERE merchant_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='revenue_splits' AND policyname='driver_select_revenue_splits') THEN
    CREATE POLICY driver_select_revenue_splits ON revenue_splits
      FOR SELECT USING (driver_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='revenue_splits' AND policyname='admin_select_revenue_splits') THEN
    CREATE POLICY admin_select_revenue_splits ON revenue_splits
      FOR SELECT USING (auth.jwt() ->> 'role' = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='revenue_splits' AND policyname='service_insert_revenue_splits') THEN
    CREATE POLICY service_insert_revenue_splits ON revenue_splits
      FOR INSERT WITH CHECK (auth.jwt() ->> 'role' = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='revenue_splits' AND policyname='admin_update_revenue_splits') THEN
    CREATE POLICY admin_update_revenue_splits ON revenue_splits
      FOR UPDATE USING (auth.jwt() ->> 'role' = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='revenue_splits' AND policyname='admin_delete_revenue_splits') THEN
    CREATE POLICY admin_delete_revenue_splits ON revenue_splits
      FOR DELETE USING (auth.jwt() ->> 'role' = 'admin');
  END IF;
END $$;

-- Atomic ride creation + revenue split insertion
-- Called from create_ride edge function to guarantee no partial writes
CREATE OR REPLACE FUNCTION create_ride_atomic(
    p_rider_id UUID,
    p_pickup_lat DOUBLE PRECISION,
    p_pickup_lng DOUBLE PRECISION,
    p_pickup_address TEXT,
    p_dropoff_lat DOUBLE PRECISION,
    p_dropoff_lng DOUBLE PRECISION,
    p_dropoff_address TEXT,
    p_status TEXT,
    p_total_fare_cents INTEGER,
    p_driver_payout_cents INTEGER,
    p_distance_meters INTEGER,
    p_duration_seconds INTEGER,
    p_route_polyline TEXT,
    p_vehicle_type TEXT,
    p_payment_method TEXT,
    p_ride_pin TEXT,
    p_idempotency_key TEXT,
    p_metadata JSONB,
    p_taxi_stand_id UUID,
    p_billed_to_merchant_id UUID,
    p_node_id UUID,
    p_driver_cut INTEGER,
    p_platform_cut INTEGER,
    p_merchant_cut INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_ride_id UUID;
    v_revenue_split_id UUID;
BEGIN
    INSERT INTO rides (
        rider_id,
        pickup_lat, pickup_lng, pickup_address,
        dropoff_lat, dropoff_lng, dropoff_address,
        status, total_fare_cents, driver_payout_cents,
        distance_meters, duration_seconds, route_polyline,
        vehicle_type, payment_method, ride_pin,
        idempotency_key, metadata,
        taxi_stand_id, billed_to_merchant_id
    ) VALUES (
        p_rider_id,
        p_pickup_lat, p_pickup_lng, p_pickup_address,
        p_dropoff_lat, p_dropoff_lng, p_dropoff_address,
        p_status, p_total_fare_cents, p_driver_payout_cents,
        p_distance_meters, p_duration_seconds, p_route_polyline,
        p_vehicle_type, p_payment_method, p_ride_pin,
        p_idempotency_key, p_metadata,
        p_taxi_stand_id, p_billed_to_merchant_id
    )
    RETURNING id INTO v_ride_id;

    INSERT INTO revenue_splits (
        ride_id, node_id, driver_id,
        platform_cut, driver_cut, merchant_cut, status
    ) VALUES (
        v_ride_id, p_node_id, NULL,
        p_platform_cut, p_driver_cut, p_merchant_cut, 'pending'
    )
    RETURNING id INTO v_revenue_split_id;

    RETURN jsonb_build_object(
        'ride_id', v_ride_id,
        'revenue_split_id', v_revenue_split_id,
        'success', true
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'error', SQLERRM,
        'success', false
    );
END;
$$;
