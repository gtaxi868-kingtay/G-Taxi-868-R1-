-- DAY-1 BLOCKER: order inserts fail. The trigger trg_emit_order_notification ->
-- notify_user_on_order() emits a notification with type='order', but
-- notifications_type_check did NOT include 'order'. Every order INSERT therefore
-- raised a check-constraint violation and rolled back — the entire order/merchant
-- flow was unusable. Never hit in prod only because 0 orders exist yet.
--
-- Verified: the only emitted type missing from the constraint is 'order'
-- (notify_user callers emit ride/payment/promo/escape/carnival/order; direct
-- inserts emit 'system'). Add 'order' to the allowed set.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY[
    'ride'::text, 'payment'::text, 'promo'::text, 'escape'::text,
    'grocery'::text, 'laundry'::text, 'carnival'::text, 'order'::text, 'system'::text
  ]));
