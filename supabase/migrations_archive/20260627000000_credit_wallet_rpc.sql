-- ── credit_wallet RPC ────────────────────────────────────────────────────
-- Credits a user's wallet with a positive transaction.
-- Idempotent on (user_id, reference_id, transaction_type) to prevent double-credit.
CREATE OR REPLACE FUNCTION public.credit_wallet(
  p_user_id      UUID,
  p_amount_cents INTEGER,
  p_type         TEXT DEFAULT 'refund',
  p_description  TEXT DEFAULT '',
  p_reference_id TEXT DEFAULT NULL
) RETURNS TABLE (success BOOLEAN, message TEXT) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_existing UUID;
BEGIN
  IF p_amount_cents <= 0 THEN
    RETURN QUERY SELECT false::BOOLEAN, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;

  -- Idempotency: skip if same reference + type already credited
  IF p_reference_id IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.wallet_transactions
    WHERE user_id = p_user_id
      AND reference_id = p_reference_id
      AND transaction_type = p_type
      AND amount > 0
    LIMIT 1;
    IF FOUND THEN
      RETURN QUERY SELECT true::BOOLEAN, 'Already credited'::TEXT;
      RETURN;
    END IF;
  END IF;

  -- Insert credit transaction
  INSERT INTO public.wallet_transactions
    (user_id, amount, transaction_type, description, reference_id, status)
  VALUES
    (p_user_id, p_amount_cents, p_type, p_description, p_reference_id, 'completed');

  -- Update cached balance if wallets table exists
  BEGIN
    UPDATE public.wallets
    SET balance_cents = COALESCE(balance_cents, 0) + p_amount_cents
    WHERE user_id = p_user_id;
  EXCEPTION WHEN undefined_table THEN
    NULL; -- wallets table hasn't been created yet — event-sourced balance still works
  END;

  RETURN QUERY SELECT true::BOOLEAN, 'Credited'::TEXT;
END;
$$;

NOTIFY pgrst, 'reload schema';
