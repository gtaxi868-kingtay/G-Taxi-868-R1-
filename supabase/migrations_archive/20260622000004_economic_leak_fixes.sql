-- ════════════════════════════════════════════════════════════════════════
-- ECONOMIC LEAK FIXES — reconcile the pool to 15% + blind receipt dedup
-- ════════════════════════════════════════════════════════════════════════
-- LEAK 1: record_pool_entry allocated 17% of gross (7/4/3/3) — 2% more than
--         the platform's 15% take. Redefined so the pool is a SUBDIVISION of
--         the 15% platform slice (an accounting of it, not a tax on gross):
--             commander 4% + merchant 3% + referral 3% (only when they exist)
--             platform   = 15% − whatever was allocated downstream (remainder).
--         Sum is mathematically locked to ROUND(gross * 0.15). Unresolved
--         shares fall to the platform — the house can never over-pay.
--
-- LEAK 2: NULL-reference receipts had no dedup. Added a "blind" guard:
--         unique (user_id, UTC day, amount_cents) WHERE reference_token IS NULL,
--         so the same value can't be submitted twice in a day when OCR fails.
-- ════════════════════════════════════════════════════════════════════════

-- ── LEAK 1: reconciled 15% waterfall ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_pool_entry(
  p_ride_id        uuid,
  p_gross_cents    bigint,
  p_platform_cents bigint DEFAULT 0,
  p_reserve_cents  bigint DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_territory_id uuid;
  v_driver_id    uuid;
  v_commander_id uuid;
  v_merchant_id  uuid;
  v_referrer_id  uuid;
  v_pool_total   bigint;   -- = 15% of gross (the platform's whole slice)
  v_commander_amt bigint := 0;
  v_merchant_amt  bigint := 0;
  v_referral_amt  bigint := 0;
  v_platform_amt  bigint;  -- remainder — absorbs unresolved shares + rounding
BEGIN
  IF p_ride_id IS NULL OR COALESCE(p_gross_cents, 0) <= 0 THEN
    RETURN;
  END IF;

  -- Idempotent: never record the same ride twice.
  IF EXISTS (SELECT 1 FROM public.ecosystem_pool_ledger WHERE ride_id = p_ride_id) THEN
    RETURN;
  END IF;

  SELECT territory_id, driver_id INTO v_territory_id, v_driver_id
  FROM public.rides WHERE id = p_ride_id;

  -- Commander = active G-Lead of the ride's territory.
  IF v_territory_id IS NOT NULL THEN
    SELECT user_id INTO v_commander_id
    FROM public.pod_commanders
    WHERE territory_id = v_territory_id AND status = 'active'
    LIMIT 1;
  END IF;

  -- Merchant (schema-tolerant — null if not a node/merchant ride).
  BEGIN
    SELECT m.created_by INTO v_merchant_id
    FROM public.rides r
    JOIN public.merchants m ON m.id = r.billed_to_merchant_id
    WHERE r.id = p_ride_id;
  EXCEPTION WHEN others THEN
    v_merchant_id := NULL;
  END;

  -- Referrer (schema-tolerant — null if no referral record).
  BEGIN
    SELECT referrer_user_id INTO v_referrer_id
    FROM public.driver_referrals
    WHERE referred_driver_id = v_driver_id
    LIMIT 1;
  EXCEPTION WHEN others THEN
    v_referrer_id := NULL;
  END;

  -- The pool IS the platform's 15% slice. Downstream cuts are carved from it.
  v_pool_total := ROUND(p_gross_cents * 0.15);
  IF v_commander_id IS NOT NULL THEN v_commander_amt := ROUND(p_gross_cents * 0.04); END IF;
  IF v_merchant_id  IS NOT NULL THEN v_merchant_amt  := ROUND(p_gross_cents * 0.03); END IF;
  IF v_referrer_id  IS NOT NULL THEN v_referral_amt  := ROUND(p_gross_cents * 0.03); END IF;

  -- Platform takes the remainder — guarantees the four buckets sum to EXACTLY 15%.
  v_platform_amt := v_pool_total - v_commander_amt - v_merchant_amt - v_referral_amt;

  -- Platform always recorded (its share never drops below the 5% base since
  -- 15 − 4 − 3 − 3 = 5; unresolved downstream shares only raise it).
  INSERT INTO public.ecosystem_pool_ledger (ride_id, beneficiary_type, beneficiary_id, pct, gross_cents, amount_cents)
  VALUES (p_ride_id, 'platform', NULL,
          ROUND(v_platform_amt::numeric / p_gross_cents * 100, 2), p_gross_cents, v_platform_amt)
  ON CONFLICT (ride_id, beneficiary_type) DO NOTHING;

  IF v_commander_id IS NOT NULL THEN
    INSERT INTO public.ecosystem_pool_ledger (ride_id, beneficiary_type, beneficiary_id, pct, gross_cents, amount_cents)
    VALUES (p_ride_id, 'commander', v_commander_id, 4.00, p_gross_cents, v_commander_amt)
    ON CONFLICT (ride_id, beneficiary_type) DO NOTHING;
  END IF;

  IF v_merchant_id IS NOT NULL THEN
    INSERT INTO public.ecosystem_pool_ledger (ride_id, beneficiary_type, beneficiary_id, pct, gross_cents, amount_cents)
    VALUES (p_ride_id, 'merchant', v_merchant_id, 3.00, p_gross_cents, v_merchant_amt)
    ON CONFLICT (ride_id, beneficiary_type) DO NOTHING;
  END IF;

  IF v_referrer_id IS NOT NULL THEN
    INSERT INTO public.ecosystem_pool_ledger (ride_id, beneficiary_type, beneficiary_id, pct, gross_cents, amount_cents)
    VALUES (p_ride_id, 'referral', v_referrer_id, 3.00, p_gross_cents, v_referral_amt)
    ON CONFLICT (ride_id, beneficiary_type) DO NOTHING;
  END IF;
END; $$;

-- ── LEAK 2: blind dedup for NULL-reference receipts ───────────────────────
-- date_trunc('day', timestamptz) is STABLE (timezone-dependent) and cannot be
-- used in an index. This wrapper pins the day to UTC, making it truly IMMUTABLE.
CREATE OR REPLACE FUNCTION public.utc_day(ts timestamptz)
RETURNS date LANGUAGE sql IMMUTABLE AS $$ SELECT (ts AT TIME ZONE 'UTC')::date $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_deposits_blind
  ON public.manual_deposits (user_id, public.utc_day(created_at), amount_cents)
  WHERE reference_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_requests_blind
  ON public.settlement_requests (user_id, public.utc_day(created_at), amount_cents)
  WHERE reference_token IS NULL;
