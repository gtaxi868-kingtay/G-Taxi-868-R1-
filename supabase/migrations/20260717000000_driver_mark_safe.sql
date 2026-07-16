-- ---------------------------------------------------------------------------
-- Driver "mark yourself safe" — safety-accountability signal
-- ---------------------------------------------------------------------------
-- After a driver finishes a drop-off (ride completed/closed, or a completed
-- grocery delivery) they toggle "I'm safe / I've left the area". If they do
-- NOT mark safe within a configurable timeout, an in-DB cron sweep flags the
-- ride/order and raises a system_alerts row for admin/ops. Purely in-DB:
-- a client-callable SECURITY DEFINER RPC + a pg_cron sweep. No edge function.
--
-- Grounded live 2026-07-17:
--   rides.driver_id      = drivers.id   (NOT the auth uid — resolve via
--                          drivers.user_id = auth.uid(), same check as
--                          public.confirm_cash_payment)
--   orders.delivery_driver_id = drivers.id ; completion = status 'delivered'
--                          with actual_delivery_at set
--   system_alerts(type, severity, title, details jsonb, resolved_at, created_at)
--                          type & severity are CHECK-constrained enums; we
--                          extend the type list with 'DRIVER_SAFETY_TIMEOUT'
--                          and use severity 'WARNING'.
--   g_config(key text, value jsonb)  — reused for tunables (no redeploy)
--
-- BLOCKER (pre-existing, out of scope): trigger public.set_ride_arrived_at()
--   fires BEFORE UPDATE on rides and references NEW.ride_id (no such column),
--   so it errors on EVERY update to rides — including this feature's RPC and
--   sweep, and any backfill. That trigger must be fixed for this feature (and
--   all ride updates) to run in production. Logic here was verified with the
--   trigger suppressed. See report/backfill note at the foot of this file.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Schema — rides (+ orders for standalone deliveries)
--    safety_flagged is the idempotency guard so the sweep never re-alerts.
-- ---------------------------------------------------------------------------
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS driver_safe     boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS driver_safe_at  timestamptz,
  ADD COLUMN IF NOT EXISTS safety_flagged  boolean     NOT NULL DEFAULT false;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS driver_safe     boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS driver_safe_at  timestamptz,
  ADD COLUMN IF NOT EXISTS safety_flagged  boolean     NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2. Config (tunable without redeploy)
--    enabled        — master switch for the whole feature
--    timeout_minutes— grace window after completion before flagging
--    cover_orders   — whether the sweep also flags standalone deliveries.
--                     Default false: there is no driver-app affordance to mark
--                     a delivery safe yet (see ActiveTripScreen note), so
--                     leave orders un-swept until that UI lands to avoid noise.
-- ---------------------------------------------------------------------------
INSERT INTO public.g_config (key, value)
VALUES ('driver_safety', jsonb_build_object(
          'enabled', true,
          'timeout_minutes', 30,
          'cover_orders', false,
          'launch_at', now()))   -- sweep ignores trips completed before this
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2b. Extend the system_alerts type enum with a safety-timeout value.
--     (CHECK constraints silently reject unknown values — drop & re-add the
--     full list per project convention.)
-- ---------------------------------------------------------------------------
ALTER TABLE public.system_alerts DROP CONSTRAINT system_alerts_type_check;
ALTER TABLE public.system_alerts ADD CONSTRAINT system_alerts_type_check
  CHECK (type = ANY (ARRAY[
    'RECONCILIATION_FAILURE','PAYMENT_ANOMALY','GPS_SPOOF_ESCALATION',
    'STATE_MACHINE_VIOLATION','RATE_LIMIT_BURST','ADMIN_OVERRIDE',
    'DRIVER_SAFETY_TIMEOUT']));

-- ---------------------------------------------------------------------------
-- 3. RPC — mark_ride_safe(p_ride_id uuid)
--    Resolves the calling driver from the JWT (auth.uid()), verifies the
--    caller IS this ride's assigned driver, then sets the flag. Idempotent.
--    Same identity check as public.confirm_cash_payment.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.mark_ride_safe(uuid);

CREATE OR REPLACE FUNCTION public.mark_ride_safe(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_ride       RECORD;
  v_driver_uid uuid;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF v_ride IS NULL THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;

  SELECT user_id INTO v_driver_uid FROM public.drivers WHERE id = v_ride.driver_id;
  IF v_driver_uid IS NULL OR v_driver_uid <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized: caller is not the assigned driver';
  END IF;

  -- Idempotent: keep the first timestamp, also clears any prior flag.
  UPDATE public.rides
     SET driver_safe    = true,
         driver_safe_at = COALESCE(driver_safe_at, now()),
         safety_flagged = false
   WHERE id = p_ride_id;

  RETURN jsonb_build_object(
    'success', true,
    'ride_id', p_ride_id,
    'driver_safe_at', COALESCE(v_ride.driver_safe_at, now())
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_ride_safe(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_ride_safe(uuid) TO authenticated;

-- Sibling RPC for standalone deliveries (orders). Same identity contract via
-- orders.delivery_driver_id. Provided so the orders columns are usable once a
-- delivery-side affordance exists; not yet wired to any UI.
DROP FUNCTION IF EXISTS public.mark_order_safe(uuid);

CREATE OR REPLACE FUNCTION public.mark_order_safe(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_order      RECORD;
  v_driver_uid uuid;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  SELECT user_id INTO v_driver_uid FROM public.drivers WHERE id = v_order.delivery_driver_id;
  IF v_driver_uid IS NULL OR v_driver_uid <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized: caller is not the assigned delivery driver';
  END IF;

  UPDATE public.orders
     SET driver_safe    = true,
         driver_safe_at = COALESCE(driver_safe_at, now()),
         safety_flagged = false
   WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'driver_safe_at', COALESCE(v_order.driver_safe_at, now())
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_order_safe(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_order_safe(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Sweep — flags completed rides/orders whose driver never marked safe.
--    Idempotent: safety_flagged flips true so a re-run never re-alerts, and a
--    NOT EXISTS on an unresolved alert is a belt-and-suspenders guard.
--    Returns the number of NEW alerts raised.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sweep_driver_safety()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_cfg          jsonb;
  v_enabled      boolean;
  v_timeout_min  integer;
  v_cover_orders boolean;
  v_cutoff       interval;
  v_launch_at    timestamptz;
  v_count        integer := 0;
  rec            record;
BEGIN
  v_cfg          := (SELECT value FROM public.g_config WHERE key = 'driver_safety');
  v_enabled      := COALESCE((v_cfg->>'enabled')::boolean, true);
  v_timeout_min  := COALESCE((v_cfg->>'timeout_minutes')::integer, 30);
  v_cover_orders := COALESCE((v_cfg->>'cover_orders')::boolean, false);
  v_cutoff       := (v_timeout_min::text || ' minutes')::interval;
  -- Only sweep trips completed at/after feature launch. Historical rides all
  -- have driver_safe=false; without this cutoff the first run would flag the
  -- entire pre-existing backlog. '-infinity' fallback = sweep everything if
  -- launch_at is somehow unset.
  v_launch_at    := COALESCE((v_cfg->>'launch_at')::timestamptz, '-infinity'::timestamptz);

  IF NOT v_enabled THEN
    RETURN 0;
  END IF;

  -- Rides ----------------------------------------------------------------
  FOR rec IN
    SELECT r.id, r.driver_id, r.completed_at
    FROM public.rides r
    WHERE r.status IN ('completed', 'closed')
      AND r.driver_id IS NOT NULL
      AND r.driver_safe = false
      AND r.safety_flagged = false
      AND r.completed_at IS NOT NULL
      AND r.completed_at >= v_launch_at
      AND r.completed_at < now() - v_cutoff
      AND NOT EXISTS (
        SELECT 1 FROM public.system_alerts a
        WHERE a.type = 'DRIVER_SAFETY_TIMEOUT'
          AND a.resolved_at IS NULL
          AND a.details->>'ride_id' = r.id::text
      )
  LOOP
    INSERT INTO public.system_alerts (type, severity, title, details)
    VALUES (
      'DRIVER_SAFETY_TIMEOUT',
      'WARNING',
      format('Driver did not mark safe after ride %s', rec.id),
      jsonb_build_object(
        'entity',          'ride',
        'ride_id',         rec.id,
        'driver_id',       rec.driver_id,
        'completed_at',    rec.completed_at,
        'timeout_minutes', v_timeout_min
      )
    );

    UPDATE public.rides SET safety_flagged = true WHERE id = rec.id;
    v_count := v_count + 1;
  END LOOP;

  -- Orders (standalone deliveries) — gated off by default -----------------
  IF v_cover_orders THEN
    FOR rec IN
      SELECT o.id, o.delivery_driver_id, o.actual_delivery_at
      FROM public.orders o
      WHERE o.status = 'delivered'
        AND o.delivery_driver_id IS NOT NULL
        AND o.driver_safe = false
        AND o.safety_flagged = false
        AND o.actual_delivery_at IS NOT NULL
        AND o.actual_delivery_at >= v_launch_at
        AND o.actual_delivery_at < now() - v_cutoff
        AND NOT EXISTS (
          SELECT 1 FROM public.system_alerts a
          WHERE a.type = 'DRIVER_SAFETY_TIMEOUT'
            AND a.resolved_at IS NULL
            AND a.details->>'order_id' = o.id::text
        )
    LOOP
      INSERT INTO public.system_alerts (type, severity, title, details)
      VALUES (
        'DRIVER_SAFETY_TIMEOUT',
        'WARNING',
        format('Driver did not mark safe after delivery %s', rec.id),
        jsonb_build_object(
          'entity',          'order',
          'order_id',        rec.id,
          'driver_id',       rec.delivery_driver_id,
          'completed_at',    rec.actual_delivery_at,
          'timeout_minutes', v_timeout_min
        )
      );

      UPDATE public.orders SET safety_flagged = true WHERE id = rec.id;
      v_count := v_count + 1;
    END LOOP;
  END IF;

  RETURN v_count;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Cron — pure in-DB sweep (no edge function, no http, no secret).
--    Every 5 minutes. Matches the scout-sweep-zones in-DB pattern.
-- ---------------------------------------------------------------------------
SELECT cron.unschedule('driver-safety-sweep')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'driver-safety-sweep');

SELECT cron.schedule('driver-safety-sweep', '*/5 * * * *', $cron$SELECT public.sweep_driver_safety();$cron$);

-- ---------------------------------------------------------------------------
-- BACKFILL (NOT executed here — depends on the broken trigger being fixed).
-- Because driver_safe/safety_flagged default false, the FIRST live sweep would
-- flag the entire historical backlog of completed rides (~102 at write time).
-- Once public.set_ride_arrived_at() is fixed, run this ONCE to baseline
-- pre-existing rows so only rides completed AFTER launch are ever flagged:
--
--   UPDATE public.rides  SET safety_flagged = true
--    WHERE status IN ('completed','closed');
--   UPDATE public.orders SET safety_flagged = true
--    WHERE status = 'delivered';
--
-- (Left as a comment so this file stays byte-for-byte in sync with what was
--  actually applied live in this session.)
-- ---------------------------------------------------------------------------
