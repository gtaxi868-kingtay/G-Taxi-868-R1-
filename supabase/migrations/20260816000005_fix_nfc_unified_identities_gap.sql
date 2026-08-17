-- Two separate "tag belongs to this profile" tables exist:
-- identity_tags and unified_identities. Registration
-- (register_unified_identity/_admin, used e.g. for Carnival band
-- keychains) writes to unified_identities ONLY. But merchant_wallet_
-- charge (the actual money-moving RPC behind merchant tap-to-pay) and
-- resolve_identity_tag (used by the merchant-mobile NFC accept-payment
-- screen) both checked identity_tags ONLY -- so any rider whose tag was
-- registered through the unified path could not be charged by a
-- merchant, and merchant staff scanning their tag saw "not found."
-- resolve_tag_to_profile already checks both tables correctly (unified
-- first, falling back to identity_tags) -- both fixed here to match
-- that pattern.
--
-- Live-verified end-to-end through the real deployed merchant_nfc_charge
-- edge function (not a dry run): a rider funded to 5000 cents, with a
-- tag registered ONLY in unified_identities, was successfully charged
-- 1500 cents by a real merchant -- rider correctly debited to 3500,
-- merchant correctly credited 1500 as merchant_commission. Test data
-- cleaned up after.
CREATE OR REPLACE FUNCTION public.merchant_wallet_charge(p_tag_uid text, p_amount_cents integer, p_merchant_id uuid, p_merchant_name text DEFAULT NULL::text)
 RETURNS TABLE(success boolean, error_message text, transaction_id uuid, rider_name text, rider_balance_after integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_rider_id        UUID;
  v_balance         INTEGER;
  v_advisory_lock_id BIGINT;
  v_txn_id          UUID := gen_random_uuid();
  v_rider_name      TEXT;
  v_merchant_user_id UUID;
BEGIN
  SELECT profile_id INTO v_rider_id
  FROM public.unified_identities
  WHERE tag_uid = p_tag_uid AND is_active = TRUE;

  IF v_rider_id IS NULL THEN
    SELECT profile_id INTO v_rider_id
    FROM public.identity_tags
    WHERE tag_uid = p_tag_uid AND is_active = TRUE;
  END IF;

  IF v_rider_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Rider keychain not found or inactive', NULL::UUID, NULL::TEXT, NULL::INTEGER;
    RETURN;
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RETURN QUERY SELECT FALSE, 'Invalid amount: must be positive', NULL::UUID, NULL::TEXT, NULL::INTEGER;
    RETURN;
  END IF;

  IF p_amount_cents > 200000 THEN
    RETURN QUERY SELECT FALSE, 'Amount exceeds maximum of TTD $2,000.00 per transaction', NULL::UUID, NULL::TEXT, NULL::INTEGER;
    RETURN;
  END IF;

  v_advisory_lock_id := ('x' || substr(md5(v_rider_id::text), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_advisory_lock_id);

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
  FROM public.wallet_transactions
  WHERE user_id = v_rider_id;

  IF v_balance < p_amount_cents THEN
    RETURN QUERY SELECT FALSE, format('Insufficient balance: TTD $%s available', (v_balance / 100.0)::numeric(10,2)), NULL::UUID, NULL::TEXT, NULL::INTEGER;
    RETURN;
  END IF;

  SELECT full_name INTO v_rider_name
  FROM public.profiles
  WHERE id = v_rider_id;

  SELECT created_by INTO v_merchant_user_id
  FROM public.merchants
  WHERE id = p_merchant_id AND is_active = TRUE;

  IF v_merchant_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Merchant not found or inactive', NULL::UUID, NULL::TEXT, NULL::INTEGER;
    RETURN;
  END IF;

  INSERT INTO public.wallet_transactions
    (id, user_id, amount, transaction_type, description, status)
  VALUES
    (v_txn_id, v_rider_id, -p_amount_cents, 'merchant_purchase',
     COALESCE(p_merchant_name, 'Merchant') || ' purchase', 'completed');

  INSERT INTO public.wallets (user_id, balance_cents)
  VALUES (v_rider_id, -p_amount_cents)
  ON CONFLICT (user_id) DO UPDATE
    SET balance_cents = GREATEST(0, wallets.balance_cents - p_amount_cents),
        updated_at = NOW();

  INSERT INTO public.wallet_transactions
    (id, user_id, amount, transaction_type, description, status)
  VALUES
    (gen_random_uuid(), v_merchant_user_id, p_amount_cents, 'merchant_commission',
     COALESCE(p_merchant_name, 'Merchant') || ' payment received', 'completed');

  INSERT INTO public.payment_ledger
    (id, user_id, amount, currency, status, provider, metadata)
  VALUES
    (gen_random_uuid(), v_rider_id, (p_amount_cents / 100.0), 'TTD',
     'captured', 'wallet',
     jsonb_build_object(
       'merchant_id', p_merchant_id,
       'merchant_name', p_merchant_name,
       'transaction_type', 'merchant_purchase',
       'tag_uid', p_tag_uid
     ));

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
  FROM public.wallet_transactions
  WHERE user_id = v_rider_id;

  RETURN QUERY SELECT TRUE, NULL::TEXT, v_txn_id, COALESCE(v_rider_name, 'Rider'), v_balance;

EXCEPTION
  WHEN OTHERS THEN
    RETURN QUERY SELECT FALSE, SQLERRM, NULL::UUID, NULL::TEXT, NULL::INTEGER;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_identity_tag(p_tag_uid text)
 RETURNS TABLE(found boolean, rider_id uuid, rider_name text, wallet_balance_cents integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_rider_id UUID;
  v_rider_name TEXT;
  v_balance INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.merchants WHERE created_by = auth.uid() AND is_active = TRUE
    UNION ALL
    SELECT 1 FROM public.merchant_staff ms JOIN public.merchants m ON m.id = ms.merchant_id
      WHERE ms.user_id = auth.uid() AND ms.is_active = TRUE AND m.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Unauthorized: not an active merchant';
  END IF;

  SELECT ui.profile_id, p.full_name
  INTO v_rider_id, v_rider_name
  FROM public.unified_identities ui
  JOIN public.profiles p ON p.id = ui.profile_id
  WHERE ui.tag_uid = p_tag_uid AND ui.is_active = TRUE;

  IF v_rider_id IS NULL THEN
    SELECT it.profile_id, p.full_name
    INTO v_rider_id, v_rider_name
    FROM public.identity_tags it
    JOIN public.profiles p ON p.id = it.profile_id
    WHERE it.tag_uid = p_tag_uid AND it.is_active = TRUE;
  END IF;

  IF v_rider_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, NULL::INTEGER;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
  FROM public.wallet_transactions
  WHERE user_id = v_rider_id;

  RETURN QUERY SELECT TRUE, v_rider_id, COALESCE(v_rider_name, 'Rider'), v_balance;
END;
$function$;
