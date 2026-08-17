-- SECURITY FIX: withdrawal_requests + request_cash_withdrawal
-- Applied to production 2026-08-11 via apply_migration
-- (name: security_lock_withdrawal_requests_and_rpc). Captured here so a rebuild
-- does not silently reopen these holes.
--
-- Found during the pre-launch audit. All three were verified against the live
-- database (pg_policies + role_table_grants + has_function_privilege), not
-- inferred from source.
--
-- C2 (Critical) -- policy "Service role can update withdrawal requests" was
--   granted TO public with USING(true) and no WITH CHECK. service_role bypasses
--   RLS entirely, so that policy never served service_role at all; it only let
--   any caller UPDATE any payout row. Anonymous callers happened to fail on an
--   unrelated `permission denied for function get_rider_active_driver`, but
--   `authenticated` HOLDS execute on that function -- so every signed-up user
--   could rewrite anyone's withdrawal (status, amount, destination phone).
--
-- C3 (Critical) -- the matching INSERT policy used WITH CHECK(true), letting any
--   caller forge a payout row for any user_id and amount. C2 + C3 together are a
--   complete fabricate-then-self-approve payout chain.
--
-- C4 (Critical) -- request_cash_withdrawal is SECURITY DEFINER and took
--   p_user_id, p_wallet_user_id and p_fee_ttd straight from the client with no
--   auth.uid() check at all: debit any victim's wallet and route the payout to an
--   attacker-supplied phone number. A NEGATIVE p_fee_ttd also inverted the debit
--   into a credit (balance - (amount + -fee)), i.e. free money, since only
--   p_amount_ttd was range-checked.
--   It additionally INSERTed into a non-existent wallet_transactions column
--   ("type"; the real column is transaction_type, NOT NULL), so it always threw
--   and rolled back. That accident is the only reason this was not already being
--   exploited -- it was one column-rename away from live theft.
--
-- The 6-arg signature is preserved deliberately: the deployed
-- request_cash_withdrawal edge function has no source in this repo and may call
-- it. Identity is now ignored from the arguments and taken from the session.

DROP POLICY IF EXISTS "Service role can update withdrawal requests" ON public.withdrawal_requests;
DROP POLICY IF EXISTS "Service role can insert withdrawal requests" ON public.withdrawal_requests;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.withdrawal_requests FROM anon, authenticated;
REVOKE SELECT ON public.withdrawal_requests FROM anon;
GRANT  SELECT ON public.withdrawal_requests TO authenticated;
-- Remaining policies are correct and intentionally kept:
--   "Users can view own withdrawal requests"  SELECT USING (auth.uid() = user_id)
--   "Admins can view all withdrawal requests" SELECT USING (profiles.role = 'admin')

CREATE OR REPLACE FUNCTION public.request_cash_withdrawal(
  p_user_id uuid, p_wallet_user_id uuid, p_user_type text,
  p_amount_ttd integer, p_fee_ttd integer, p_phone_number text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_daily_total INTEGER; v_config JSONB; v_enabled BOOLEAN;
  v_max_daily INTEGER; v_min_amount INTEGER;
  v_wallet_balance INTEGER; v_withdrawal_id UUID; v_total INTEGER;
BEGIN
  -- identity comes from the session, never from the caller's arguments
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;
  IF p_user_id IS DISTINCT FROM auth.uid() OR p_wallet_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Forbidden');
  END IF;
  -- a negative fee would turn this debit into a credit
  IF p_amount_ttd IS NULL OR p_amount_ttd <= 0
     OR p_fee_ttd IS NULL OR p_fee_ttd < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid amount or fee');
  END IF;

  SELECT value::jsonb INTO v_config FROM system_config WHERE key = 'cash_withdrawal_config';
  IF v_config IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cash withdrawals not configured');
  END IF;
  v_enabled    := (v_config->>'enabled')::boolean;
  v_max_daily  := COALESCE((v_config->>'max_daily_cents')::integer, 150000);
  v_min_amount := COALESCE((v_config->>'min_amount_cents')::integer, 5000);
  IF NOT v_enabled THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cash withdrawals coming soon');
  END IF;
  IF p_amount_ttd < v_min_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Minimum withdrawal is TTD $' || (v_min_amount/100)::text);
  END IF;
  IF p_amount_ttd > v_max_daily THEN
    RETURN jsonb_build_object('success', false, 'error', 'Maximum withdrawal is TTD $' || (v_max_daily/100)::text || ' per request');
  END IF;

  -- serialise concurrent withdrawals for this wallet
  PERFORM 1 FROM wallets WHERE user_id = p_wallet_user_id FOR UPDATE;

  SELECT COALESCE(SUM(amount_ttd),0) INTO v_daily_total FROM withdrawal_requests
   WHERE user_id = p_user_id AND requested_at >= CURRENT_DATE
     AND status IN ('pending','sent','completed');
  IF (v_daily_total + p_amount_ttd) > v_max_daily THEN
    RETURN jsonb_build_object('success', false, 'error', 'Daily withdrawal limit of TTD $' || (v_max_daily/100)::text || ' exceeded');
  END IF;

  v_total := p_amount_ttd + p_fee_ttd;
  -- balance truth is SUM(wallet_transactions), not the wallets.balance_cents cache
  v_wallet_balance := public.get_wallet_balance(p_wallet_user_id);
  IF v_wallet_balance < v_total THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient wallet balance');
  END IF;

  -- correct columns: transaction_type (NOT NULL), not "type"; 'payout' is a
  -- valid value of wallet_transactions_transaction_type_check
  INSERT INTO wallet_transactions (user_id, amount, transaction_type, description, status)
  VALUES (p_wallet_user_id, -v_total, 'payout',
          'Cash withdrawal: TTD $' || (p_amount_ttd/100)::text || ' + TTD $' || (p_fee_ttd/100)::text || ' fee',
          'completed');

  UPDATE wallets SET balance_cents = balance_cents - v_total WHERE user_id = p_wallet_user_id;

  INSERT INTO withdrawal_requests (user_id, user_type, amount_ttd, fee_ttd, phone_number, status)
  VALUES (p_user_id, p_user_type, p_amount_ttd, p_fee_ttd, p_phone_number, 'pending')
  RETURNING id INTO v_withdrawal_id;

  RETURN jsonb_build_object('success', true, 'withdrawal_id', v_withdrawal_id,
    'amount_ttd', p_amount_ttd, 'fee_ttd', p_fee_ttd, 'phone_number', p_phone_number);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.request_cash_withdrawal(uuid,uuid,text,integer,integer,text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.request_cash_withdrawal(uuid,uuid,text,integer,integer,text) TO authenticated;
-- admin_update_withdrawal_status already checks profiles.role = 'admin' internally
-- and fails closed for anon (auth.uid() IS NULL); revoking anon is defence in depth.
REVOKE EXECUTE ON FUNCTION public.admin_update_withdrawal_status(uuid,text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_update_withdrawal_status(uuid,text) TO authenticated;
