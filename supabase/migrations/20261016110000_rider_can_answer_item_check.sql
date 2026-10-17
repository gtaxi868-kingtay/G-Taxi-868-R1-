-- ═══════════════════════════════════════════════════════════════════
-- Grocery/laundry "Verify your items": the rider's APPROVE button did
-- nothing. When the store checks the items in (verify_handoff, merchant
-- PIN) the order goes to 'awaiting_approval' and the rider app shows the
-- item list with APPROVE / REJECT. Both buttons wrote orders.status
-- directly, but the only rider UPDATE policy on orders is "Riders can
-- cancel their own orders" (status = 'cancelled'), so APPROVE (grocery
-- 'confirmed', laundry 'processing') and laundry REJECT ('rejected') were
-- refused, and the app ignored the error (PROVEN, pg_policies 2026-10-16).
--
-- rider_answer_item_check(order, approve): the rider's own order, only
-- while it is 'awaiting_approval'.
--   approve -> 'processing' (the status verify_handoff set just before
--              asking; the rider app shows it as "Being Prepared" /
--              "Being Cleaned")
--   reject  -> 'cancelled'  (the same status the existing cancel policy
--              already lets a rider set)
-- No new table permissions: the rider still cannot write orders directly.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rider_answer_item_check(p_order_id uuid, p_approve boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_order record;
  v_next text := CASE WHEN p_approve THEN 'processing' ELSE 'cancelled' END;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please sign in again.');
  END IF;
  IF p_approve IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing answer.');
  END IF;

  SELECT id, rider_id, status INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL OR v_order.rider_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found.');
  END IF;
  IF v_order.status <> 'awaiting_approval' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This order is no longer waiting for your check.',
                              'status', v_order.status);
  END IF;

  UPDATE public.orders SET status = v_next, updated_at = now() WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'status', v_next);
END;
$function$;

REVOKE ALL ON FUNCTION public.rider_answer_item_check(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rider_answer_item_check(uuid, boolean) TO authenticated;
