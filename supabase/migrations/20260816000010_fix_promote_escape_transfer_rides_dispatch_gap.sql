-- promote_escape_transfer_rides (cron, every 10 min, escrow_prepaid
-- G-Escape ground transfers only) flipped rides from 'scheduled' to
-- 'searching' with a bare UPDATE and never inserted a fresh
-- dispatch_queue row. The ride's ORIGINAL dispatch_queue row (now that
-- the NOT NULL insert bug is fixed, migration 20260816000006) has
-- expires_at = 10 minutes after the original request time -- hours
-- before the real pickup. Net effect: a promoted escrow_prepaid ground
-- transfer sat at status='searching' forever with nothing ever offering
-- it to a driver. Live revenue-path bug, not a product decision --
-- flagged in project_dispatch_queue_and_scheduled_rides.md.
--
-- Fixed by mirroring create_ride/index.ts's own dispatch_queue insert
-- shape for each promoted ride, with expires_at set 10 minutes from
-- promotion time (not original request time).
--
-- Dry-run verified in a rolled-back transaction with a synthetic
-- scheduled escrow_prepaid ride due within the 90-minute window: ride
-- flips to 'searching', a fresh pending dispatch_queue row is created
-- with a future expires_at.
--
-- Companion fix: apps/rider-facing "schedule for later" and G-Escape
-- transfer promotion both use scheduled_for -- the SAME gap existed in
-- platform_intelligence/index.ts's activateScheduledTransfers (handles
-- ALL scheduled rides, 45-min window, not just escrow_prepaid) --
-- fixed there too (see edge function source), live-verified end-to-end
-- through the real deployed function via x-cron-secret: a real
-- synthetic scheduled ride correctly flipped to 'searching' AND got a
-- fresh dispatch_queue row with a future expiry. Test data cleaned up
-- after.
CREATE OR REPLACE FUNCTION public.promote_escape_transfer_rides()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_promoted integer;
  v_ride RECORD;
BEGIN
  FOR v_ride IN
    SELECT id, pickup_lat, pickup_lng
    FROM public.rides
    WHERE status = 'scheduled'
      AND payment_method = 'escrow_prepaid'
      AND scheduled_for IS NOT NULL
      AND scheduled_for <= now() + INTERVAL '90 minutes'
  LOOP
    UPDATE public.rides
    SET status = 'searching', updated_at = now()
    WHERE id = v_ride.id;

    INSERT INTO public.dispatch_queue
      (task_type, ride_id, order_id, pickup_lat, pickup_lng, priority, status, attempts, expires_at)
    VALUES
      ('RIDE', v_ride.id, NULL, v_ride.pickup_lat, v_ride.pickup_lng, 50, 'pending', 0, now() + INTERVAL '10 minutes');
  END LOOP;

  GET DIAGNOSTICS v_promoted = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'promoted', v_promoted);
END;
$function$;
