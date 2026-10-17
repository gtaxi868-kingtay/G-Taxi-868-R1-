-- ═══════════════════════════════════════════════════════════════════
-- Drivers can see and accept the deliveries offered to them.
--
-- Before (verified live 2026-10-15): orders had no SELECT or UPDATE policy
-- for drivers at all. The driver app read the offered/assigned order (got
-- nothing) and accepted by updating orders.delivery_driver_id directly
-- (0 rows, no error). So no delivery could ever be assigned, and
-- process_stop_arrival then refused every step ("Not assigned").
--
-- After:
--  - Drivers may READ an order only while they hold a pending/accepted offer
--    for it, or are its assigned delivery driver.
--  - Accepting goes through accept_delivery_offer(): checks the offer is the
--    caller's, still pending and unexpired, and the order is not already
--    taken; then marks the offer accepted, assigns the driver and starts the
--    delivery steps. Row-locked, so two drivers cannot both win.
--  - No UPDATE access to orders is given to drivers.
-- ═══════════════════════════════════════════════════════════════════

-- Helper bypasses RLS on purpose: the delivery_offers policies already
-- reference orders, so querying delivery_offers from an orders policy would
-- recurse. Same pattern as auth_merchant_ids().
CREATE OR REPLACE FUNCTION public.auth_driver_order_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT o.id FROM public.orders o
   WHERE o.delivery_driver_id IN (SELECT d.id FROM public.drivers d WHERE d.user_id = auth.uid())
  UNION
  SELECT f.order_id FROM public.delivery_offers f
   WHERE f.status IN ('pending', 'accepted')
     AND f.driver_id IN (SELECT d.id FROM public.drivers d WHERE d.user_id = auth.uid());
$function$;

REVOKE ALL ON FUNCTION public.auth_driver_order_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_driver_order_ids() TO authenticated;

DROP POLICY IF EXISTS "Drivers see orders offered or assigned to them" ON public.orders;
CREATE POLICY "Drivers see orders offered or assigned to them"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (id IN (SELECT public.auth_driver_order_ids()));

CREATE OR REPLACE FUNCTION public.accept_delivery_offer(p_offer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_driver_id uuid;
  v_offer record;
  v_order record;
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a registered driver.');
  END IF;

  SELECT * INTO v_offer FROM public.delivery_offers WHERE id = p_offer_id FOR UPDATE;
  IF v_offer.id IS NULL OR v_offer.driver_id <> v_driver_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Offer not found.');
  END IF;
  IF v_offer.status <> 'pending' OR v_offer.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'This delivery is no longer available.');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_offer.order_id FOR UPDATE;
  IF v_order.id IS NULL OR (v_order.delivery_driver_id IS NOT NULL AND v_order.delivery_driver_id <> v_driver_id)
     OR v_order.status IN ('delivered', 'cancelled') THEN
    UPDATE public.delivery_offers SET status = 'expired', responded_at = now() WHERE id = p_offer_id;
    RETURN jsonb_build_object('success', false, 'error', 'This delivery is no longer available.');
  END IF;

  UPDATE public.delivery_offers SET status = 'accepted', responded_at = now() WHERE id = p_offer_id;
  UPDATE public.orders
     SET delivery_driver_id = v_driver_id,
         delivery_status = COALESCE(delivery_status, 'driver_assigned')
   WHERE id = v_order.id;

  RETURN jsonb_build_object('success', true, 'order_id', v_order.id, 'driver_payout_cents', v_offer.driver_payout_cents);
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_delivery_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_delivery_offer(uuid) TO authenticated;
