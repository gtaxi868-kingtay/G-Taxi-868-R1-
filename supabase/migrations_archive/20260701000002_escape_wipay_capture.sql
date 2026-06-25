-- G-Escape WiPay capture RPC.
-- Backfilled into git from live DB (ffbbuafgeypvkpcuvdnv) on 2026-06-24 to close
-- source drift: this RPC was deployed directly and never committed. Called by
-- wipay_webhook on a successful `gescape-` callback. Mirrors the wallet/Stripe
-- capture path: validates ACTIVE_HOLD under FOR UPDATE, advances to CAPTURED,
-- and increments confirmed_guests + flight allocation.

CREATE OR REPLACE FUNCTION public.capture_escape_wipay_payment(
  p_reservation_id uuid,
  p_wipay_transaction_id text DEFAULT NULL::text
)
  RETURNS TABLE(success boolean, message text)
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $function$
DECLARE
  v_rec RECORD;
BEGIN
  SELECT id, escape_package_id, flight_block_id, guest_count, status
  INTO v_rec
  FROM public.package_reservations
  WHERE id = p_reservation_id AND status = 'ACTIVE_HOLD'
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT id, status INTO v_rec
    FROM public.package_reservations
    WHERE id = p_reservation_id;

    IF NOT FOUND THEN
      success := FALSE; message := 'Reservation not found.';
    ELSE
      success := FALSE; message := 'Reservation is in ' || v_rec.status || ' status — expected ACTIVE_HOLD.';
    END IF;
    RETURN NEXT; RETURN;
  END IF;

  UPDATE public.package_reservations
  SET status = 'CAPTURED',
      captured_at = now(),
      updated_at = now(),
      wipay_auth_token = COALESCE(p_wipay_transaction_id, wipay_auth_token)
  WHERE id = p_reservation_id;

  UPDATE public.escape_packages
  SET confirmed_guests = confirmed_guests + v_rec.guest_count,
      updated_at = now()
  WHERE id = v_rec.escape_package_id;

  IF v_rec.flight_block_id IS NOT NULL THEN
    UPDATE public.flight_blocks
    SET allocated_seats = allocated_seats + v_rec.guest_count,
        updated_at = now()
    WHERE id = v_rec.flight_block_id;
  END IF;

  success := TRUE; message := 'Escape reservation captured successfully.';
  RETURN NEXT;
END;
$function$;
