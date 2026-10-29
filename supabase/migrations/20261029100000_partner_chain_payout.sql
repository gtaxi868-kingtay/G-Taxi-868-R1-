-- ═══════════════════════════════════════════════════════════════════
-- Partner chain, last link: shops actually GET their recruiter 2%,
-- and a partner has its driver invite code from the day it activates.
-- (Founder direction, 2026-10-29; closes the gap named in
--  20261017100000_shop_earns_2pct_on_drivers_it_onboards.sql:
--  "NOT included: paying the pending ledger out to the shop's wallet.")
--
-- What this adds:
--   payout_shop_recruiter_earnings(merchant?)  flips 'pending' rows in
--     shop_recruiter_revshare_ledger to 'paid' (paid_at set) and credits
--     the shop owner's wallet with the summed revshare_cents, using the
--     SAME wallet mechanism as pay_rider_referral_on_first_ride /
--     apply_referral_code (20261016100000): an INSERT into
--     public.wallet_transactions (transaction_type 'bonus', status
--     'completed', reference_id set). Owner = merchants.created_by, the
--     same owner lookup credit_merchant_commission uses
--     (20260816000003). A shop with no owner linked is skipped, its rows
--     stay 'pending', and it is reported in the result.
--     Idempotent: only 'pending' rows are selected (locked FOR UPDATE)
--     and flipped in the same transaction, so a second run pays 0.
--   ensure_merchant_driver_invite_code trigger  the invite code used to
--     be generated lazily inside merchant_driver_network() the first
--     time an owner opened the screen — a partner could be live with no
--     code when its first driver arrived. Now the code is issued the
--     moment a merchant becomes an active G-Partner, mirroring that
--     function's own condition (COALESCE(is_active,false) AND
--     activation_status = 'active') and its exact format:
--     'S' || first 6 hex chars, upper-cased, of md5(id || clock time).
--   cron 'shop-recruiter-payout-daily'  runs the payout every day at
--     05:15, following the consolidated cron pattern
--     (20260701000013_consolidated_cron_jobs.sql).
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Pay the pending ledger out to shop owners' wallets ───────────
CREATE OR REPLACE FUNCTION public.payout_shop_recruiter_earnings(p_merchant_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_merchant      record;
  v_total         bigint;
  v_rows          integer;
  v_merchants_paid integer := 0;
  v_rows_paid      integer := 0;
  v_total_cents    bigint  := 0;
  v_skipped        jsonb   := '[]'::jsonb;
BEGIN
  FOR v_merchant IN
    SELECT m.id, m.created_by
      FROM public.merchants m
     WHERE (p_merchant_id IS NULL OR m.id = p_merchant_id)
       AND EXISTS (SELECT 1 FROM public.shop_recruiter_revshare_ledger l
                    WHERE l.merchant_id = m.id AND l.status = 'pending')
     ORDER BY m.created_at
  LOOP
    -- No owner login: the money has nowhere to land. Leave the rows
    -- 'pending' (they pay out the day an owner is linked) and report it.
    IF v_merchant.created_by IS NULL THEN
      v_skipped := v_skipped || jsonb_build_object(
        'merchant_id', v_merchant.id, 'reason', 'skipped_no_owner');
      CONTINUE;
    END IF;

    -- Lock this shop's pending rows, then total them. A second run —
    -- manual or the daily cron — sees no 'pending' rows and pays 0.
    PERFORM 1 FROM public.shop_recruiter_revshare_ledger
     WHERE merchant_id = v_merchant.id AND status = 'pending'
     FOR UPDATE;

    SELECT COALESCE(sum(revshare_cents), 0), count(*)
      INTO v_total, v_rows
      FROM public.shop_recruiter_revshare_ledger
     WHERE merchant_id = v_merchant.id AND status = 'pending';

    IF v_rows = 0 THEN
      CONTINUE;
    END IF;

    UPDATE public.shop_recruiter_revshare_ledger
       SET status = 'paid', paid_at = now()
     WHERE merchant_id = v_merchant.id AND status = 'pending';

    IF v_total > 0 THEN
      INSERT INTO public.wallet_transactions
        (user_id, amount, transaction_type, description, reference_id, status)
      VALUES
        (v_merchant.created_by, v_total::integer, 'bonus',
         'Shop recruiter earnings — 2% of fares from drivers your shop onboarded',
         'shop_recruiter_payout:' || v_merchant.id::text || ':' || gen_random_uuid()::text,
         'completed');
    END IF;

    v_merchants_paid := v_merchants_paid + 1;
    v_rows_paid      := v_rows_paid + v_rows;
    v_total_cents    := v_total_cents + v_total;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'merchants_paid', v_merchants_paid,
    'rows_paid', v_rows_paid,
    'total_cents', v_total_cents,
    'skipped_no_owner', v_skipped);
END;
$function$;

REVOKE ALL ON FUNCTION public.payout_shop_recruiter_earnings(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_shop_recruiter_earnings(uuid) TO service_role;

-- ── 2. Issue the driver invite code the moment a partner activates ──
CREATE OR REPLACE FUNCTION public.ensure_merchant_driver_invite_code()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_code     text;
  v_attempts int := 0;
BEGIN
  -- Mirror merchant_driver_network() (20261017100000): a shop is live
  -- when COALESCE(is_active, false) AND activation_status = 'active',
  -- and its code is 'S' + 6 upper-case hex chars from md5(id || time).
  IF NEW.driver_invite_code IS NULL
     AND COALESCE(NEW.is_active, false)
     AND NEW.activation_status = 'active' THEN
    LOOP
      v_code := 'S' || upper(substring(md5(NEW.id::text || clock_timestamp()::text) from 1 for 6));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.merchants WHERE driver_invite_code = v_code);
      v_attempts := v_attempts + 1;
      IF v_attempts > 20 THEN RAISE EXCEPTION 'Could not generate unique code'; END IF;
    END LOOP;
    NEW.driver_invite_code := v_code;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_merchants_driver_invite_code ON public.merchants;
CREATE TRIGGER trg_merchants_driver_invite_code
  BEFORE INSERT OR UPDATE OF is_active, activation_status, driver_invite_code
  ON public.merchants
  FOR EACH ROW EXECUTE FUNCTION public.ensure_merchant_driver_invite_code();

-- ── 3. Daily payout (house cron pattern, 20260701000013) ────────────
DO $cronsetup$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping cron setup';
    RETURN;
  END IF;
  IF current_setting('cron.database_name', true) IS DISTINCT FROM current_database() THEN
    RAISE NOTICE 'pg_cron not bound to % — skipping cron setup', current_database();
    RETURN;
  END IF;

  PERFORM cron.schedule('shop-recruiter-payout-daily', '15 5 * * *',
    $job$SELECT public.payout_shop_recruiter_earnings()$job$);
END
$cronsetup$;
