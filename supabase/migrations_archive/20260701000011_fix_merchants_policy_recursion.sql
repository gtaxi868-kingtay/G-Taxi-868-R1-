-- Fix recursion introduced by 20260701000008's "Owners and staff can view own
-- merchant" policy: it subqueried merchant_staff, whose own policy
-- ("Merchant owner manages staff") subqueries merchants -> merchants <-> merchant_staff
-- infinite recursion on any merchants RLS evaluation.
--
-- Route through the existing STABLE SECURITY DEFINER helper auth_merchant_ids(),
-- which bypasses RLS on both tables, so no cycle can form. Functionally
-- identical (owner via created_by + staff via merchant_staff).

DROP POLICY IF EXISTS "Owners and staff can view own merchant" ON public.merchants;
CREATE POLICY "Owners and staff can view own merchant" ON public.merchants
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.auth_merchant_ids()));
