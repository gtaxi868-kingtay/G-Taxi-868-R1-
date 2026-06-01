-- Phase 4: RLS Fixes
-- Fixes all critical, high, and medium RLS issues from the audit.

-- ============================================================
-- 1. hotel_bookings — Remove public read (data leak: guest names, room numbers)
-- ============================================================
DROP POLICY IF EXISTS "Guests can view own hotel sync" ON public.hotel_bookings;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='hotel_bookings' AND policyname='Service role manages hotel bookings') THEN
    DROP POLICY IF EXISTS "Service role manages hotel bookings" ON public.hotel_bookings;
CREATE POLICY "Service role manages hotel bookings" ON public.hotel_bookings
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- 2. merchant_api_keys — Drop logically incorrect policy (auth.uid() = merchant_id)
--    The correct policy from 20260402000000 uses profiles.merchant_id check.
-- ============================================================
DROP POLICY IF EXISTS "Merchants can view their own API keys" ON public.merchant_api_keys;
DROP POLICY IF EXISTS "Service Role full access to keys" ON public.merchant_api_keys;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='merchant_api_keys' AND policyname='Service role manages merchant_api_keys') THEN
    DROP POLICY IF EXISTS "Service role manages merchant_api_keys" ON public.merchant_api_keys;
CREATE POLICY "Service role manages merchant_api_keys" ON public.merchant_api_keys
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- 3. order_substitutions — Enable RLS and add ownership policy
-- ============================================================
ALTER TABLE IF EXISTS public.order_substitutions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view substitutions for their orders" ON public.order_substitutions;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='order_substitutions' AND policyname='Users can view substitutions for their orders') THEN
    DROP POLICY IF EXISTS "Users can view substitutions for their orders" ON public.order_substitutions;
CREATE POLICY "Users can view substitutions for their orders" ON public.order_substitutions
      FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.orders
          WHERE orders.id = order_id AND orders.rider_id = auth.uid())
      );
  END IF;
END $$;

-- ============================================================
-- 4. Replace auth.jwt() ->> 'role' with proper TO service_role
-- ============================================================

-- 4a. payment_ledger
DROP POLICY IF EXISTS "Service role manages ledger" ON public.payment_ledger;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payment_ledger' AND policyname='Service role manages ledger') THEN
    DROP POLICY IF EXISTS "Service role manages ledger" ON public.payment_ledger;
CREATE POLICY "Service role manages ledger" ON public.payment_ledger
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 4b. revenue_splits — 4 policies using auth.jwt() ->> 'role'
DROP POLICY IF EXISTS "admin_select_revenue_splits" ON public.revenue_splits;
DROP POLICY IF EXISTS "service_insert_revenue_splits" ON public.revenue_splits;
DROP POLICY IF EXISTS "admin_update_revenue_splits" ON public.revenue_splits;
DROP POLICY IF EXISTS "admin_delete_revenue_splits" ON public.revenue_splits;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='revenue_splits' AND policyname='admin_select_revenue_splits') THEN
    CREATE POLICY admin_select_revenue_splits ON revenue_splits
      FOR SELECT TO service_role USING (true);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='revenue_splits' AND policyname='service_insert_revenue_splits') THEN
    CREATE POLICY service_insert_revenue_splits ON revenue_splits
      FOR INSERT TO service_role WITH CHECK (true);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='revenue_splits' AND policyname='admin_update_revenue_splits') THEN
    CREATE POLICY admin_update_revenue_splits ON revenue_splits
      FOR UPDATE TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='revenue_splits' AND policyname='admin_delete_revenue_splits') THEN
    CREATE POLICY admin_delete_revenue_splits ON revenue_splits
      FOR DELETE TO service_role USING (true);
  END IF;
END $$;

-- 4c. dealer_partners
DROP POLICY IF EXISTS "Admins and service role can read dealer partners" ON public.dealer_partners;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='dealer_partners' AND policyname='Admins and service role can read dealer partners') THEN
    DROP POLICY IF EXISTS "Admins and service role can read dealer partners" ON public.dealer_partners;
CREATE POLICY "Admins and service role can read dealer partners" ON public.dealer_partners
      FOR SELECT TO service_role USING (true);
  END IF;
END $$;

-- ============================================================
-- 5. drivers — Remove full-row exposure via "Anyone can see online drivers"
--    The drivers_map_view (security_invoker) handles safe exposure.
-- ============================================================
DROP POLICY IF EXISTS "Anyone can see online drivers" ON public.drivers;

-- ============================================================
-- 6. order_items — Add WITH CHECK to merchant UPDATE policy
-- ============================================================
DROP POLICY IF EXISTS "Merchants can update own order items" ON public.order_items;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='order_items' AND policyname='Merchants can update own order items') THEN
    DROP POLICY IF EXISTS "Merchants can update own order items" ON public.order_items;
CREATE POLICY "Merchants can update own order items" ON public.order_items
      FOR UPDATE USING (
        EXISTS (SELECT 1 FROM orders
          WHERE orders.id = order_items.order_id
            AND orders.merchant_id = (SELECT merchant_id FROM profiles WHERE id = auth.uid()))
      ) WITH CHECK (
        order_id IN (SELECT id FROM orders
          WHERE merchant_id = (SELECT merchant_id FROM profiles WHERE id = auth.uid()))
      );
  END IF;
END $$;

-- ============================================================
-- 7. ratings — Add driver visibility for their own ratings
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ratings' AND policyname='Drivers can view their own ratings') THEN
    DROP POLICY IF EXISTS "Drivers can view their own ratings" ON public.ratings;
CREATE POLICY "Drivers can view their own ratings" ON public.ratings
      FOR SELECT TO authenticated
      USING (auth.uid() = driver_id);
  END IF;
END $$;

-- ============================================================
-- 8. orders — Add rider UPDATE policy (cancel)
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='orders' AND policyname='Riders can cancel their own orders') THEN
    DROP POLICY IF EXISTS "Riders can cancel their own orders" ON public.orders;
CREATE POLICY "Riders can cancel their own orders" ON public.orders
      FOR UPDATE
      USING (auth.uid() = rider_id AND status NOT IN ('delivered', 'cancelled'))
      WITH CHECK (auth.uid() = rider_id AND status = 'cancelled');
  END IF;
END $$;

-- ============================================================
-- 9. profiles — Remove redundant subscription policy (duplicates "Own profile read")
-- ============================================================
DROP POLICY IF EXISTS "Allow users to read own subscription tier" ON public.profiles;

-- ============================================================
-- 10. vehicle_sales — Fix tautological subquery in dealer policy
-- ============================================================
DROP POLICY IF EXISTS "Dealer sees own sales" ON public.vehicle_sales;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vehicle_sales' AND policyname='Dealer sees own sales') THEN
    DROP POLICY IF EXISTS "Dealer sees own sales" ON public.vehicle_sales;
CREATE POLICY "Dealer sees own sales" ON public.vehicle_sales
      FOR SELECT USING (
        dealer_id IN (SELECT id FROM dealer_partners WHERE id = (SELECT merchant_id FROM profiles WHERE id = auth.uid()))
      );
  END IF;
END $$;
