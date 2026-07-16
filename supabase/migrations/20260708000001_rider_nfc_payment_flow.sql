-- Add metadata column to payment_ledger if missing (needed for merchant_wallet_charge RPC)
ALTER TABLE payment_ledger ADD COLUMN IF NOT EXISTS metadata JSONB;

-- RPC: rider-initiated wallet payment to a merchant
-- Identifies rider by user_id (from JWT) instead of identity tag
CREATE OR REPLACE FUNCTION rider_wallet_payment(
  p_user_id UUID,
  p_merchant_id UUID,
  p_amount_cents BIGINT,
  p_merchant_name TEXT DEFAULT 'Merchant'
) RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
  v_balance BIGINT;
  v_txn_id UUID;
  v_merchant_user_id UUID;
  v_rider_name TEXT;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error_message', 'Invalid amount');
  END IF;
  IF p_amount_cents > 200000 THEN
    RETURN jsonb_build_object('success', false, 'error_message', 'Amount exceeds TTD $2,000.00 per transaction');
  END IF;

  SELECT created_by INTO v_merchant_user_id
  FROM merchants WHERE id = p_merchant_id AND is_active = TRUE;
  IF v_merchant_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_message', 'Merchant not found or inactive');
  END IF;

  PERFORM pg_advisory_xact_lock(
    ('x' || substr(md5(p_user_id::text), 1, 16))::bit(64)::bigint
  );

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
  FROM wallet_transactions WHERE user_id = p_user_id;

  IF v_balance < p_amount_cents THEN
    RETURN jsonb_build_object('success', false, 'error_message',
      format('Insufficient balance: TTD $%s available', (v_balance / 100.0)::numeric(10,2)));
  END IF;

  SELECT full_name INTO v_rider_name FROM profiles WHERE id = p_user_id;

  v_txn_id := gen_random_uuid();
  INSERT INTO wallet_transactions (id, user_id, amount, transaction_type, description, status)
  VALUES (v_txn_id, p_user_id, -p_amount_cents, 'merchant_purchase',
    COALESCE(p_merchant_name, 'Merchant') || ' purchase', 'completed');

  INSERT INTO wallets (user_id, balance_cents)
  VALUES (p_user_id, -p_amount_cents)
  ON CONFLICT (user_id) DO UPDATE
    SET balance_cents = GREATEST(0, wallets.balance_cents - p_amount_cents),
        updated_at = NOW();

  INSERT INTO wallet_transactions (id, user_id, amount, transaction_type, description, status)
  VALUES (gen_random_uuid(), v_merchant_user_id, p_amount_cents, 'merchant_commission',
    COALESCE(p_merchant_name, 'Merchant') || ' payment received', 'completed');

  INSERT INTO payment_ledger (id, user_id, amount, currency, status, provider, metadata)
  VALUES (gen_random_uuid(), p_user_id, (p_amount_cents / 100.0), 'TTD', 'captured', 'wallet',
    jsonb_build_object(
      'merchant_id', p_merchant_id,
      'merchant_name', p_merchant_name,
      'transaction_type', 'rider_initiated_purchase'
    ));

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
  FROM wallet_transactions WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_txn_id,
    'rider_name', v_rider_name,
    'rider_balance_after', v_balance,
    'amount_cents', p_amount_cents
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error_message', SQLERRM);
END;
$$;
