-- complete_ride/index.ts has always called credit_merchant_commission
-- with 5 params (p_merchant_id, p_ride_id, p_amount_cents,
-- p_staff_member_id, p_staff_amount_cents), but the live function only
-- accepted 3. PostgREST rejected the call with no matching signature
-- every time; the failure is caught and logged as "non-fatal," so every
-- ride from a merchant node/kiosk completes normally while the merchant
-- is never credited. Confirmed live: zero wallet_transactions rows with
-- transaction_type='merchant_commission' exist in production despite
-- vendor_commissions accumulating rows.
--
-- Extended to the real signature. Staff crediting no-ops gracefully when
-- merchant_staff.user_id is NULL (which it always currently is -- the
-- staff roster UI never sets it, no invite/claim flow exists yet,
-- documented separately) rather than erroring, matching this function's
-- existing "merchant not found -> return" pattern.
--
-- IMPORTANT: this signature fix is confirmed correct in isolation (a
-- direct authenticated-role PostgREST call with the identical 5-arg
-- payload reliably credits the merchant's real wallet). However,
-- end-to-end verification through the REAL complete_ride service-role
-- call path has NOT succeeded -- see project memory
-- (project_merchant_commission_service_role_mystery.md) for the full,
-- unresolved investigation. Do not assume the underlying P0 (merchant
-- never credited) is closed just because this migration is applied.
DROP FUNCTION public.credit_merchant_commission(uuid, uuid, integer);

CREATE FUNCTION public.credit_merchant_commission(
  p_merchant_id uuid,
  p_ride_id uuid,
  p_amount_cents integer,
  p_staff_member_id uuid DEFAULT NULL,
  p_staff_amount_cents integer DEFAULT 0
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_staff_user_id UUID;
BEGIN
  IF NOT public.feature_enabled('merchant_commission_enabled') THEN
    RETURN;
  END IF;

  SELECT created_by INTO v_user_id FROM public.merchants WHERE id = p_merchant_id;
  IF v_user_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
  VALUES (v_user_id, p_ride_id, p_amount_cents, 'merchant_commission', 'Vendor kiosk commission', 'completed');

  IF p_staff_member_id IS NOT NULL AND p_staff_amount_cents > 0 THEN
    SELECT user_id INTO v_staff_user_id FROM public.merchant_staff WHERE id = p_staff_member_id;
    IF v_staff_user_id IS NOT NULL THEN
      INSERT INTO public.wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
      VALUES (v_staff_user_id, p_ride_id, p_staff_amount_cents, 'merchant_commission', 'Vendor kiosk staff commission', 'completed');
    END IF;
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.credit_merchant_commission(uuid, uuid, integer, uuid, integer) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.credit_merchant_commission(uuid, uuid, integer, uuid, integer) TO service_role;
