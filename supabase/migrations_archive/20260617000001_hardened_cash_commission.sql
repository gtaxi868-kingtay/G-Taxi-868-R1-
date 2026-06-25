-- ── deduct_driver_commission_hardened RPC ─────────────────────────────────
-- Safely deducts the platform fee from the driver's wallet during a cash ride.
-- Enforces SELECT FOR UPDATE to prevent race conditions.
CREATE OR REPLACE FUNCTION public.deduct_driver_commission_hardened(
  p_driver_user_id UUID,
  p_ride_id UUID,
  p_amount_cents INTEGER,
  p_description TEXT
) RETURNS TABLE (success BOOLEAN, message TEXT) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_balance INTEGER;
BEGIN
  IF p_amount_cents <= 0 THEN
    RETURN QUERY SELECT true::BOOLEAN, 'No commission to deduct'::TEXT;
    RETURN;
  END IF;

  -- Lock the wallet row
  SELECT balance_cents INTO v_current_balance
  FROM public.wallets
  WHERE user_id = p_driver_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- If wallet doesn't exist, create it locked (edge case handling)
    INSERT INTO public.wallets (user_id, balance_cents)
    VALUES (p_driver_user_id, 0)
    RETURNING balance_cents INTO v_current_balance;
  END IF;

  -- Deduct the balance
  UPDATE public.wallets
  SET balance_cents = balance_cents - p_amount_cents
  WHERE user_id = p_driver_user_id;

  -- Insert ledger record
  INSERT INTO public.wallet_transactions
    (user_id, ride_id, amount, transaction_type, description, status)
  VALUES
    (p_driver_user_id, p_ride_id, -p_amount_cents, 'commission_fee', p_description, 'completed');

  RETURN QUERY SELECT true::BOOLEAN, 'Commission deducted'::TEXT;
END;
$$;

NOTIFY pgrst, 'reload schema';
