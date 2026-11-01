-- A business could update the items on its orders but never read them, so its
-- order page could only show a total. Own orders only, the same check the update
-- policy already uses.
DROP POLICY IF EXISTS "Merchants can view own order items" ON public.order_items;
CREATE POLICY "Merchants can view own order items" ON public.order_items
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.orders o
         WHERE o.id = order_items.order_id
           AND o.merchant_id IN (SELECT public.auth_merchant_ids())));
