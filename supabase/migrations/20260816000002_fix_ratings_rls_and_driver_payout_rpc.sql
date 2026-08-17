-- Two independent fixes from the Phase 3 monorepo audit follow-up.

-- 1. ratings RLS: "Drivers can view their own ratings" checked
-- auth.uid() = driver_id, but ratings.driver_id stores drivers.id, not
-- the driver's auth id (same identity gotcha as rides.driver_id,
-- documented elsewhere in this codebase). Every driver's individual-
-- ratings query has always returned empty via RLS. Dry-run verified
-- live: a real driver can now see a rating targeting their drivers.id row.
DROP POLICY IF EXISTS "Drivers can view their own ratings" ON public.ratings;
CREATE POLICY "Drivers can view their own ratings" ON public.ratings
FOR SELECT
USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid()));

-- 2. request_driver_payout: request_payout/index.ts was written expecting
-- this RPC to RAISE a coded exception on failure (it has an
-- ERROR_MESSAGES table keyed on MINIMUM_PAYOUT/BANK_DETAILS_MISSING/
-- PAYOUT_ALREADY_PENDING/INSUFFICIENT_BALANCE) and return a scalar
-- request id on success. The live function instead returned jsonb
-- {success:false, error:...} without ever raising, and implemented none
-- of the four checks except a bare balance comparison -- no minimum
-- payout, no bank-details check, no duplicate-pending-request guard, no
-- row lock despite the edge function's own header comment claiming "FOR
-- UPDATE serialized." Since the Postgres-level `error` was always null,
-- a failed payout request (insufficient balance or otherwise) was
-- reported to the driver as {success:true, request_id: <the jsonb blob>}.
--
-- Fixed to raise real exceptions matching the codes the edge function
-- already expects, added the three missing checks, and locks the driver
-- row (FOR UPDATE). Dry-run verified live, all 5 cases: no bank details
-- -> BANK_DETAILS_MISSING, below minimum -> MINIMUM_PAYOUT, no balance ->
-- INSUFFICIENT_BALANCE, real balance -> succeeds returning a real
-- request id, second request while one is pending ->
-- PAYOUT_ALREADY_PENDING.
DROP FUNCTION public.request_driver_payout(uuid, integer);

CREATE FUNCTION public.request_driver_payout(p_driver_id uuid, p_amount_cents integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_auth_user_id uuid;
  v_balance integer;
  v_bank_details jsonb;
  v_request_id uuid;
BEGIN
  SELECT user_id, bank_details INTO v_auth_user_id, v_bank_details
  FROM public.drivers WHERE id = p_driver_id FOR UPDATE;

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Driver not found';
  END IF;

  IF p_amount_cents < 2000 THEN
    RAISE EXCEPTION 'MINIMUM_PAYOUT';
  END IF;

  IF v_bank_details IS NULL OR v_bank_details->>'bank_name' IS NULL OR v_bank_details->>'account_number' IS NULL THEN
    RAISE EXCEPTION 'BANK_DETAILS_MISSING';
  END IF;

  IF EXISTS (SELECT 1 FROM public.payout_requests WHERE driver_id = p_driver_id AND status = 'pending') THEN
    RAISE EXCEPTION 'PAYOUT_ALREADY_PENDING';
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO v_balance FROM public.wallet_transactions WHERE user_id = v_auth_user_id;
  IF v_balance < p_amount_cents THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
  END IF;

  INSERT INTO public.payout_requests (driver_id, amount_cents, status)
  VALUES (p_driver_id, p_amount_cents, 'pending')
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.request_driver_payout(uuid, integer) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.request_driver_payout(uuid, integer) TO service_role;
