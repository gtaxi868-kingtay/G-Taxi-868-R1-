-- =============================================================================
-- NFC Dispatch Layer — Connects puck taps to unified order creation
-- =============================================================================
-- Changes:
--   1. Adds task_type + puck_id columns to orders table
--   2. Creates merchant_nodes view (alias for kiosk_nodes)
--   3. Adds orders table to Realtime publication for postgres_changes
--   4. Creates indexes for efficient Realtime filter lookups
-- =============================================================================
-- SECURITY NOTE:
--   No `WITH CHECK (true)` policy. Edge functions use service_role key
--   which bypasses RLS. An open INSERT policy would allow anon abuse.
-- =============================================================================

-- 1. Add missing columns to orders
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS task_type TEXT DEFAULT 'transport',
ADD COLUMN IF NOT EXISTS puck_id TEXT;

COMMENT ON COLUMN public.orders.task_type IS
  'Unified service type: transport, fulfillment, barber, carwash, laundry, grocery, etc.';
COMMENT ON COLUMN public.orders.puck_id IS
  'NFC tag_uid of the Smart Puck that generated this order. Links to kiosk_nodes.tag_uid.';

-- 2. Create merchant_nodes view for code-level naming consistency
--    The physical table is kiosk_nodes; the view lets client code reference
--    merchant_nodes without a rename. Both names resolve to the same data.
CREATE OR REPLACE VIEW public.merchant_nodes AS
SELECT * FROM public.kiosk_nodes;

-- 3. Enable Realtime publication for orders table
--    This is the reliable delivery backbone: merchant apps subscribe via
--    postgres_changes, which fires automatically on INSERT regardless of
--    whether the edge function's broadcast channel delivered.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;
END;
$$;

-- 4. Create indexes for efficient Realtime filter lookups
CREATE INDEX IF NOT EXISTS idx_orders_puck_id ON public.orders(puck_id);
CREATE INDEX IF NOT EXISTS idx_orders_merchant_task ON public.orders(merchant_id, task_type);
