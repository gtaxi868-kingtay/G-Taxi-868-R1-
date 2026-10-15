-- ═══════════════════════════════════════════════════════════════════
-- orders.delivery_status: the driver-side delivery step.
--
-- process_stop_arrival (live) and the driver app's ActiveDeliveryScreen
-- both read and write orders.delivery_status, but the column never existed
-- (verified 2026-10-15). process_stop_arrival's order lookup therefore
-- failed with "Delivery not found" and no delivery could move past
-- "assigned". Values: driver_assigned -> driver_picked_up ->
-- driver_en_route -> delivered (set only by process_stop_arrival, service
-- role; no client grant is needed or given).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_status text;
