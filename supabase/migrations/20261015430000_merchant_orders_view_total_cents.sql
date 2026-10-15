-- ═══════════════════════════════════════════════════════════════════
-- Merchant app Orders screen loads.
--
-- Before (verified live 2026-10-15): merchant-mobile reads
-- merchant_orders selecting total_cents, but the view only exposed it as
-- `total`, so every load failed ("Could not load your orders").
-- After: the view also exposes total_cents (appended; `total` kept for any
-- other reader). Still security_invoker, so orders RLS applies unchanged.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.merchant_orders
WITH (security_invoker = true) AS
 SELECT o.id,
    o.status,
    o.created_at,
    o.total_cents AS total,
    o.merchant_id,
    m.created_by AS merchant_user_id,
    o.rider_id,
    o.delivery_driver_id,
    o.delivery_address,
    o.payment_status,
    o.updated_at,
    o.total_cents,
    o.delivery_method
   FROM orders o
     JOIN merchants m ON m.id = o.merchant_id
  WHERE o.merchant_id IS NOT NULL;
