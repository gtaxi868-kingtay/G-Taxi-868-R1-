-- ═══════════════════════════════════════════════════════════════════
-- Laundry: server-priced orders with a pickup location; riders can no
-- longer create orders or edit order money fields directly.
--
-- Before (verified live 2026-10-14/15):
--  1. LaundryEstimatorScreen inserted into orders straight from the phone.
--     Every insert failed: the AFTER INSERT trigger handle_new_order_pins
--     (SECURITY INVOKER) writes order_handoff_pins, which riders cannot.
--     0 laundry orders have ever existed.
--  2. Behind that: the phone computed AND wrote total_cents (rates lived only
--     in LaundryLandingScreen), riders held INSERT/UPDATE on orders with RLS
--     checking only rider_id, and create_order_payment_intent charges
--     orders.total_cents. Granting the pins table would have let any rider
--     pay 1 cent for laundry.
--  3. trigger_enqueue_order_dispatch queued laundry with no pickup
--     coordinates, and process_dispatch_queue fails any job without them.
--
-- After:
--  - Rates live in pricing_config (same values the app showed), so admin can
--    change them; the server is the only thing that prices a laundry order.
--  - create_laundry_order(): validates service / weight (1-30 lb, the app's
--    slider range) / payment method / a pickup point inside Trinidad &
--    Tobago, computes the total, and creates the order as the caller.
--  - Dispatch now carries the order's pickup point (and LAUNDRY task type).
--  - authenticated loses INSERT on orders and keeps UPDATE only on the two
--    columns the apps actually write directly: status (rider/merchant web)
--    and delivery_driver_id (driver accepting a delivery). Every other order
--    write already goes through service-role edge functions or SECURITY
--    DEFINER functions, which column grants do not affect.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Price list (cents per lb) -- the values the rider app already shows.
INSERT INTO public.pricing_config (key, value_cents)
VALUES ('LAUNDRY_RATE_WASH_FOLD_CENTS_PER_LB', 500),
       ('LAUNDRY_RATE_DRY_CLEAN_CENTS_PER_LB', 1200),
       ('LAUNDRY_RATE_IRON_CENTS_PER_LB', 300)
ON CONFLICT (key) DO NOTHING;

-- 2. The only way to create a laundry order.
CREATE OR REPLACE FUNCTION public.create_laundry_order(
  p_service text,
  p_weight_lbs integer,
  p_payment_method text,
  p_pickup_lat double precision,
  p_pickup_lng double precision,
  p_pickup_address text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rate_key text;
  v_rate integer;
  v_total integer;
  v_label text;
  v_order_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please sign in.');
  END IF;

  v_rate_key := CASE p_service
    WHEN 'wash_fold' THEN 'LAUNDRY_RATE_WASH_FOLD_CENTS_PER_LB'
    WHEN 'dry_clean' THEN 'LAUNDRY_RATE_DRY_CLEAN_CENTS_PER_LB'
    WHEN 'iron'      THEN 'LAUNDRY_RATE_IRON_CENTS_PER_LB'
  END;
  v_label := CASE p_service WHEN 'wash_fold' THEN 'Wash & Fold' WHEN 'dry_clean' THEN 'Dry Clean' WHEN 'iron' THEN 'Iron Only' END;
  IF v_rate_key IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown laundry service.');
  END IF;

  IF p_weight_lbs IS NULL OR p_weight_lbs < 1 OR p_weight_lbs > 30 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Weight must be between 1 and 30 lb.');
  END IF;

  IF p_payment_method NOT IN ('cash', 'card') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment must be cash or card.');
  END IF;

  -- Trinidad & Tobago bounding box (incl. Tobago). A driver has to be sent.
  IF p_pickup_lat IS NULL OR p_pickup_lng IS NULL
     OR p_pickup_lat NOT BETWEEN 9.95 AND 11.40
     OR p_pickup_lng NOT BETWEEN -61.95 AND -60.45 THEN
    RETURN jsonb_build_object('success', false, 'error', 'We need a pickup location in Trinidad or Tobago.');
  END IF;

  SELECT value_cents INTO v_rate FROM public.pricing_config WHERE key = v_rate_key;
  IF v_rate IS NULL OR v_rate <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Laundry pricing is not set up yet.');
  END IF;
  v_total := v_rate * p_weight_lbs;

  INSERT INTO public.orders (
    rider_id, total_cents, status, payment_method, payment_status,
    delivery_method, task_type, pickup_lat, pickup_lng,
    delivery_lat, delivery_lng, delivery_address, rider_notes
  ) VALUES (
    v_uid, v_total, 'pending', p_payment_method,
    CASE WHEN p_payment_method = 'cash' THEN 'cash_on_delivery' ELSE 'pending' END,
    'laundry_pickup', 'laundry', p_pickup_lat, p_pickup_lng,
    p_pickup_lat, p_pickup_lng, NULLIF(trim(p_pickup_address), ''),
    format('%s, about %s lb', v_label, p_weight_lbs)
  )
  RETURNING id INTO v_order_id;

  RETURN jsonb_build_object('success', true, 'order_id', v_order_id, 'total_cents', v_total,
                            'rate_cents_per_lb', v_rate, 'service', v_label);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_laundry_order(text, integer, text, double precision, double precision, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_laundry_order(text, integer, text, double precision, double precision, text) TO authenticated;

-- 3. Dispatch carries the pickup point (and the laundry task type).
CREATE OR REPLACE FUNCTION public.trigger_enqueue_order_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.delivery_method IN ('courier', 'laundry_pickup') THEN
    INSERT INTO dispatch_queue (order_id, delivery_method, status, pickup_lat, pickup_lng, task_type)
    VALUES (NEW.id, NEW.delivery_method, 'pending',
            COALESCE(NEW.pickup_lat, NEW.delivery_lat), COALESCE(NEW.pickup_lng, NEW.delivery_lng),
            CASE WHEN NEW.delivery_method = 'laundry_pickup' THEN 'LAUNDRY' ELSE 'DELIVERY' END)
    ON CONFLICT (order_id) DO NOTHING;
    RETURN NEW;
  END IF;
  IF NEW.task_type IN ('grocery', 'laundry', 'courier') AND (NEW.delivery_method IS NULL OR NEW.delivery_method = '') AND NEW.status = 'pending' THEN
    INSERT INTO dispatch_queue (order_id, delivery_method, status, pickup_lat, pickup_lng)
    VALUES (NEW.id, COALESCE(NEW.delivery_method, 'courier'), 'pending',
            COALESCE(NEW.pickup_lat, NEW.delivery_lat), COALESCE(NEW.pickup_lng, NEW.delivery_lng))
    ON CONFLICT (order_id) DO NOTHING;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$function$;

-- 4. Phones can't create orders or touch order money fields.
REVOKE INSERT ON public.orders FROM authenticated;
REVOKE UPDATE ON public.orders FROM authenticated;
GRANT UPDATE (status, delivery_driver_id) ON public.orders TO authenticated;
