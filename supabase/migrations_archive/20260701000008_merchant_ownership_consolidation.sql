-- DAY-1 READINESS: fix merchant-ownership RLS so merchants can actually see
-- their own data once real data exists.
--
-- Root cause: merchant ownership was wired two incompatible ways and NEITHER
-- was populated —
--   * merchants.created_by  (used by the merchant app + admin onboarding +
--                            products/merchant_staff/vendor_commissions policies)
--   * profiles.merchant_id  (used by orders/order_items/merchant_services/
--                            merchant_appointments/merchant_api_keys/intake_logs
--                            policies — but never set)
-- so on day 1 every merchant would see an EMPTY orders/services/appointments/
-- API-keys/intake screen. We standardize on the canonical convention the app
-- already uses: merchants.created_by (owner) + merchant_staff (additional users).
--
-- Implemented via one STABLE SECURITY DEFINER helper to keep every policy
-- consistent and avoid drift. The helper uses auth.uid() internally and only
-- ever returns the CALLER's own merchant ids, so it is safe to expose.

CREATE OR REPLACE FUNCTION public.auth_merchant_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id FROM public.merchants m WHERE m.created_by = auth.uid()
  UNION
  SELECT ms.merchant_id FROM public.merchant_staff ms WHERE ms.user_id = auth.uid()
$$;

REVOKE EXECUTE ON FUNCTION public.auth_merchant_ids() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.auth_merchant_ids() TO authenticated, service_role;

-- ── orders ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Merchants can view their business orders" ON public.orders;
CREATE POLICY "Merchants can view their business orders" ON public.orders
  FOR SELECT TO authenticated
  USING (merchant_id IN (SELECT public.auth_merchant_ids()));

DROP POLICY IF EXISTS "Merchants can update their business orders" ON public.orders;
CREATE POLICY "Merchants can update their business orders" ON public.orders
  FOR UPDATE TO authenticated
  USING      (merchant_id IN (SELECT public.auth_merchant_ids()))
  WITH CHECK (merchant_id IN (SELECT public.auth_merchant_ids()));

-- ── order_items ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Merchants can update own order items" ON public.order_items;
CREATE POLICY "Merchants can update own order items" ON public.order_items
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND o.merchant_id IN (SELECT public.auth_merchant_ids())))
  WITH CHECK (order_id IN (
    SELECT o.id FROM public.orders o
    WHERE o.merchant_id IN (SELECT public.auth_merchant_ids())));

-- ── merchant_services ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Merchants manage their own services" ON public.merchant_services;
CREATE POLICY "Merchants manage their own services" ON public.merchant_services
  FOR ALL TO authenticated
  USING      (merchant_id IN (SELECT public.auth_merchant_ids()))
  WITH CHECK (merchant_id IN (SELECT public.auth_merchant_ids()));

-- ── merchant_appointments ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Merchants manage appointments for their business" ON public.merchant_appointments;
CREATE POLICY "Merchants manage appointments for their business" ON public.merchant_appointments
  FOR ALL TO authenticated
  USING      (merchant_id IN (SELECT public.auth_merchant_ids()))
  WITH CHECK (merchant_id IN (SELECT public.auth_merchant_ids()));

-- ── merchant_api_keys (owner-only: sensitive) ───────────────────────────────
DROP POLICY IF EXISTS "Merchants can view own API keys" ON public.merchant_api_keys;
CREATE POLICY "Merchants can view own API keys" ON public.merchant_api_keys
  FOR SELECT TO authenticated
  USING (merchant_id IN (SELECT m.id FROM public.merchants m WHERE m.created_by = auth.uid()));

-- ── merchant_intake_logs ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "merchant_intake_logs_select_own" ON public.merchant_intake_logs;
CREATE POLICY "merchant_intake_logs_select_own" ON public.merchant_intake_logs
  FOR SELECT TO authenticated
  USING (merchant_id IN (SELECT public.auth_merchant_ids()));

DROP POLICY IF EXISTS "merchant_intake_logs_insert_own" ON public.merchant_intake_logs;
CREATE POLICY "merchant_intake_logs_insert_own" ON public.merchant_intake_logs
  FOR INSERT TO authenticated
  WITH CHECK (merchant_id IN (SELECT public.auth_merchant_ids()));

-- ── merchants: owner/staff can always see their OWN row (even while pending) ──
-- Existing "view active merchants" only exposes is_active=true rows, so a
-- pending merchant could not see its own record (breaking the merchant_orders
-- join + dashboard). This permissive policy is OR'd with the existing one.
DROP POLICY IF EXISTS "Owners and staff can view own merchant" ON public.merchants;
CREATE POLICY "Owners and staff can view own merchant" ON public.merchants
  FOR SELECT TO authenticated
  USING (created_by = auth.uid()
         OR id IN (SELECT ms.merchant_id FROM public.merchant_staff ms WHERE ms.user_id = auth.uid()));
