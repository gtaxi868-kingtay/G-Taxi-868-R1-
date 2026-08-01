-- ═══════════════════════════════════════════════════════════════════
-- SETTLEMENT V3 (2026-07-16) — owner spec, four independent changes:
--
-- 1) Merchant NODE commission unified to 2% of the PLATFORM'S TAKE (not
--    gross fare). Replaces the two-path inconsistency: cash paid 1% of
--    gross via compute_ride_split, wallet/card paid 5% of gross via a
--    separate merchant.commission_rate lookup in complete_ride. Both now
--    read the same NODE_COMMISSION_RATE_ON_PLATFORM_BPS config key.
--
-- 2) Merchant PIN fee (grid safe/hot-zone driver alerting, AI-assisted)
--    becomes type-based + per-merchant-overridable, admin controlled —
--    replaces the single global pin_fee_cents. The existing 90-day trial
--    (merchant_subscriptions.trial_end_at) is UNCHANGED; only the amount
--    that applies after the trial is now type/agreement-driven.
--
-- 3) Merchants can opt in/out of offering riders a discount, independent
--    of ad spend (merchant_promotions) — merchant-controlled toggle.
--
-- 4) Referral kickbacks funded from the RESERVE, not the driver/platform
--    split — "cannot affect margins":
--      - Driver onboards a rider (keychain tap / share link): once that
--        rider completes 5+ rides, credit the driver's wallet 5% of the
--        rider's LIFETIME fare paid, one-time.
--      - Rider onboards a rider (friends/family share link): same
--        mechanic, same 5-ride threshold, 3% instead of 5%.
--    Both draw from capital_reserve_ledger via a new guarded spend RPC
--    that never lets the reserve go negative — if the reserve can't
--    cover it, the reward is deferred (logged, not silently dropped) for
--    admin/G to review, rather than reducing driver or platform pay.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 0. Config keys ───────────────────────────────────────────────────
INSERT INTO public.pricing_config (key, value_cents, description) VALUES
    ('NODE_COMMISSION_RATE_ON_PLATFORM_BPS', 200,
     'Merchant node "rent" — bps of the PLATFORM''S take (not gross fare) paid to the kiosk merchant per ride dispatched from their node. 200 = 2%.'),
    ('DRIVER_ONBOARD_REWARD_BPS', 500,
     'One-time wallet credit to a driver, as bps of the onboarded rider''s LIFETIME fare paid, triggered once that rider completes RIDER_REFERRAL_TARGET_RIDES. Funded from capital_reserve_ledger, not the ride split.'),
    ('RIDER_ONBOARD_REWARD_BPS', 300,
     'Same mechanic as DRIVER_ONBOARD_REWARD_BPS but for rider-refers-rider (friends/family share links). Funded from the reserve.'),
    ('RIDER_REFERRAL_TARGET_RIDES', 5,
     'Completed-ride threshold that triggers a driver-onboard or rider-onboard kickback payout.')
ON CONFLICT (key) DO NOTHING;

-- ─── 1. Merchant pin fee, type-based + per-merchant override ─────────
CREATE TABLE IF NOT EXISTS public.merchant_pin_fee_rates (
    store_type      text PRIMARY KEY,
    monthly_fee_cents integer NOT NULL CHECK (monthly_fee_cents >= 0),
    description     text,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid
);

ALTER TABLE public.merchant_pin_fee_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read pin fee rates" ON public.merchant_pin_fee_rates;
CREATE POLICY "Read pin fee rates" ON public.merchant_pin_fee_rates FOR SELECT USING (true);
GRANT SELECT ON public.merchant_pin_fee_rates TO anon, authenticated;

-- Seed sane starting defaults by business category — admin adjusts per
-- real agreements from here. Foot-traffic-driven service businesses
-- (spa/barbershop) are priced higher than pure-logistics stops.
INSERT INTO public.merchant_pin_fee_rates (store_type, monthly_fee_cents, description) VALUES
    ('grocery',              15000, 'Grocery / supermarket'),
    ('pharmacy',             15000, 'Pharmacy'),
    ('spa',                  20000, 'Spa / wellness — high foot-traffic conversion value'),
    ('barbershop',           20000, 'Barbershop / salon — high foot-traffic conversion value'),
    ('restaurant',           17500, 'Restaurant / food service'),
    ('retail',               15000, 'General retail'),
    ('professional_services',12500, 'Offices, clinics, professional services'),
    ('other',                15000, 'Uncategorized default')
ON CONFLICT (store_type) DO NOTHING;

-- Per-merchant override (an individual negotiated agreement wins over the
-- type default). NULL = use the type rate.
ALTER TABLE public.merchant_subscriptions
    ADD COLUMN IF NOT EXISTS pin_fee_override_cents integer CHECK (pin_fee_override_cents IS NULL OR pin_fee_override_cents >= 0);

CREATE OR REPLACE FUNCTION public.resolve_merchant_pin_fee_cents(p_merchant_id uuid)
RETURNS integer
LANGUAGE plpgsql STABLE
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_override integer;
    v_store_type text;
    v_rate integer;
BEGIN
    SELECT ms.pin_fee_override_cents INTO v_override
    FROM public.merchant_subscriptions ms WHERE ms.merchant_id = p_merchant_id;
    IF v_override IS NOT NULL THEN RETURN v_override; END IF;

    SELECT COALESCE(m.store_type, 'other') INTO v_store_type
    FROM public.merchants m WHERE m.id = p_merchant_id;

    SELECT monthly_fee_cents INTO v_rate
    FROM public.merchant_pin_fee_rates WHERE store_type = v_store_type;

    RETURN COALESCE(v_rate, (SELECT monthly_fee_cents FROM public.merchant_pin_fee_rates WHERE store_type = 'other'), 15000);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_pin_fee_rate(p_store_type text, p_monthly_fee_cents integer)
RETURNS public.merchant_pin_fee_rates
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE v_row public.merchant_pin_fee_rates;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;
    IF p_monthly_fee_cents < 0 THEN RAISE EXCEPTION 'monthly_fee_cents must be >= 0'; END IF;

    INSERT INTO public.merchant_pin_fee_rates (store_type, monthly_fee_cents, updated_by, updated_at)
    VALUES (lower(trim(p_store_type)), p_monthly_fee_cents, auth.uid(), now())
    ON CONFLICT (store_type) DO UPDATE SET
        monthly_fee_cents = p_monthly_fee_cents, updated_by = auth.uid(), updated_at = now()
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$$;

-- p_override_cents = NULL clears the override and falls back to the type rate.
CREATE OR REPLACE FUNCTION public.admin_set_merchant_pin_fee_override(p_merchant_id uuid, p_override_cents integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;
    IF p_override_cents IS NOT NULL AND p_override_cents < 0 THEN
        RAISE EXCEPTION 'override_cents must be >= 0 or NULL';
    END IF;
    UPDATE public.merchant_subscriptions SET pin_fee_override_cents = p_override_cents WHERE merchant_id = p_merchant_id;
    IF NOT FOUND THEN
        INSERT INTO public.merchant_subscriptions (merchant_id, pin_fee_override_cents, status)
        VALUES (p_merchant_id, p_override_cents, 'trial');
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_pin_fee_rate(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_pin_fee_rate(text, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_set_merchant_pin_fee_override(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_merchant_pin_fee_override(uuid, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.resolve_merchant_pin_fee_cents(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_merchant_pin_fee_cents(uuid) TO authenticated, service_role;

-- ─── 2. Merchant rider-discount opt-in (independent of ad spend) ─────
ALTER TABLE public.merchants
    ADD COLUMN IF NOT EXISTS rider_discount_active boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS rider_discount_pct numeric(4,1) CHECK (rider_discount_pct IS NULL OR (rider_discount_pct > 0 AND rider_discount_pct <= 50));

-- Merchant self-service toggle — the merchant owner only, on their own
-- record. Separate from admin RPCs above (this is the merchant's own lever).
CREATE OR REPLACE FUNCTION public.merchant_set_rider_discount(p_merchant_id uuid, p_active boolean, p_pct numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.merchants WHERE id = p_merchant_id AND created_by = auth.uid()
    ) AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;
    IF p_active AND (p_pct IS NULL OR p_pct <= 0 OR p_pct > 50) THEN
        RAISE EXCEPTION 'pct must be between 0 and 50 when active';
    END IF;
    UPDATE public.merchants
    SET rider_discount_active = p_active,
        rider_discount_pct = CASE WHEN p_active THEN p_pct ELSE rider_discount_pct END
    WHERE id = p_merchant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_set_rider_discount(uuid, boolean, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_set_rider_discount(uuid, boolean, numeric) TO authenticated;

-- ─── 3. Node commission math — unified 2% of PLATFORM'S take ─────────
-- Restructured so vendor_cut is carved from the platform's raw share
-- (gross − driver_pool − commander_cut − reserve), not from gross.
CREATE OR REPLACE FUNCTION public.compute_ride_split(p_ride_id uuid, p_gross_cents bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_driver_bps int; v_reserve_bps int; v_commander_bps int; v_node_bps int;
  v_driver_pool bigint; v_reserve bigint; v_commander_cut bigint := 0; v_vendor_cut bigint := 0;
  v_driver_net bigint; v_platform_raw bigint; v_platform_fee bigint;
  v_driver_id uuid; v_driver_uid uuid; v_commander_id uuid; v_node_id uuid; v_merchant_id uuid;
BEGIN
  IF p_gross_cents IS NULL OR p_gross_cents <= 0 THEN
    RETURN jsonb_build_object('driver_net',0,'commander_cut',0,'vendor_cut',0,'reserve',0,
      'platform_fee',0,'commander_id',NULL,'merchant_id',NULL,'node_id',NULL);
  END IF;
  SELECT
    COALESCE(MAX(CASE WHEN key='DRIVER_SHARE_CENTS' THEN value_cents END),8000),
    COALESCE(MAX(CASE WHEN key='RESERVE_RATE_CENTS' THEN value_cents END),150),
    COALESCE(MAX(CASE WHEN key='COMMANDER_REVSHARE_RATE_CENTS' THEN value_cents END),200),
    COALESCE(MAX(CASE WHEN key='NODE_COMMISSION_RATE_ON_PLATFORM_BPS' THEN value_cents END),200)
  INTO v_driver_bps, v_reserve_bps, v_commander_bps, v_node_bps
  FROM public.pricing_config WHERE key IN ('DRIVER_SHARE_CENTS','RESERVE_RATE_CENTS','COMMANDER_REVSHARE_RATE_CENTS','NODE_COMMISSION_RATE_ON_PLATFORM_BPS');

  v_driver_pool := ROUND(p_gross_cents * v_driver_bps / 10000.0);
  v_reserve     := ROUND(p_gross_cents * v_reserve_bps / 10000.0);

  SELECT driver_id, vendor_node_id INTO v_driver_id, v_node_id FROM public.rides WHERE id = p_ride_id;
  v_driver_uid := (SELECT user_id FROM public.drivers WHERE id = v_driver_id);
  IF v_driver_uid IS NULL THEN v_driver_uid := v_driver_id; END IF;

  SELECT referred_by_commander_id INTO v_commander_id FROM public.profiles WHERE id = v_driver_uid;
  IF v_commander_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.pod_commanders WHERE id = v_commander_id AND status='active') THEN
    v_commander_cut := ROUND(p_gross_cents * v_commander_bps / 10000.0);
  ELSE
    v_commander_id := NULL;
  END IF;
  v_driver_net := v_driver_pool - v_commander_cut;

  -- Platform's raw share BEFORE the node rent is carved out.
  v_platform_raw := p_gross_cents - v_driver_net - v_commander_cut - v_reserve;

  IF v_node_id IS NOT NULL THEN
    SELECT merchant_id INTO v_merchant_id FROM public.kiosk_nodes WHERE id = v_node_id;
    IF v_merchant_id IS NOT NULL AND v_platform_raw > 0 THEN
      -- "Rent" = node_bps of the PLATFORM's take, not of gross fare.
      v_vendor_cut := ROUND(v_platform_raw * v_node_bps / 10000.0);
    END IF;
  END IF;

  v_platform_fee := v_platform_raw - v_vendor_cut;

  RETURN jsonb_build_object('driver_net',v_driver_net,'commander_cut',v_commander_cut,'vendor_cut',v_vendor_cut,
    'reserve',v_reserve,'platform_fee',v_platform_fee,'commander_id',v_commander_id,
    'merchant_id',v_merchant_id,'node_id',v_node_id);
END;
$function$;

-- ─── 4. Reserve-funded spend, guarded against depleting the reserve ──
CREATE TABLE IF NOT EXISTS public.reserve_spend_log (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    spend_type      text NOT NULL,            -- 'driver_onboard_reward' | 'rider_onboard_reward'
    recipient_user_id uuid NOT NULL,
    amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
    status          text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','deferred_insufficient_reserve')),
    reference_id    uuid,
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.reserve_spend_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own reserve spend" ON public.reserve_spend_log;
CREATE POLICY "Own reserve spend" ON public.reserve_spend_log
    FOR SELECT USING (recipient_user_id = auth.uid());

-- Never lets locked_cents go negative. On insufficient reserve, logs a
-- 'deferred' row (visible to admin) instead of silently skipping or
-- pulling from the driver/platform split.
CREATE OR REPLACE FUNCTION public.spend_from_reserve(
    p_spend_type text, p_recipient_user_id uuid, p_amount_cents bigint,
    p_reference_id uuid, p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_locked bigint;
    v_log_id uuid;
BEGIN
    IF p_amount_cents <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'amount must be positive'); END IF;

    SELECT locked_cents INTO v_locked FROM public.reserve_health WHERE id = true FOR UPDATE;
    IF v_locked IS NULL OR v_locked < p_amount_cents THEN
        INSERT INTO public.reserve_spend_log (spend_type, recipient_user_id, amount_cents, status, reference_id, notes)
        VALUES (p_spend_type, p_recipient_user_id, p_amount_cents, 'deferred_insufficient_reserve', p_reference_id, p_notes)
        RETURNING id INTO v_log_id;
        RETURN jsonb_build_object('success', false, 'error', 'insufficient reserve', 'log_id', v_log_id);
    END IF;

    INSERT INTO public.capital_reserve_ledger (ride_id, amount_cents, status, source_type, notes)
    VALUES (p_reference_id, -p_amount_cents, 'spent', p_spend_type, COALESCE(p_notes, p_spend_type));

    UPDATE public.reserve_health SET
        locked_cents = locked_cents - p_amount_cents,
        reserve_health_ratio = (locked_cents - p_amount_cents)::numeric / NULLIF(target_deployment_cents, 0),
        computed_at = now()
    WHERE id = true;

    INSERT INTO public.wallet_transactions (user_id, amount, transaction_type, description, status)
    VALUES (p_recipient_user_id, p_amount_cents, 'bonus', COALESCE(p_notes, p_spend_type), 'completed');

    INSERT INTO public.reserve_spend_log (spend_type, recipient_user_id, amount_cents, status, reference_id, notes)
    VALUES (p_spend_type, p_recipient_user_id, p_amount_cents, 'paid', p_reference_id, p_notes)
    RETURNING id INTO v_log_id;

    RETURN jsonb_build_object('success', true, 'log_id', v_log_id, 'amount_cents', p_amount_cents);
END;
$$;

REVOKE ALL ON FUNCTION public.spend_from_reserve(text, uuid, bigint, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spend_from_reserve(text, uuid, bigint, uuid, text) TO service_role, authenticated;

-- ─── 5. Driver-onboard reward: rider hits 5 rides → driver gets 5% of ─
-- ─────────────────── that rider's lifetime fare, one-time, from reserve
-- Replaces the old commission_boost_pct mechanic on referral_rewards,
-- which was never wired into compute_ride_split (dead code) — this
-- finishes the feature per the explicit new spec instead.
CREATE OR REPLACE FUNCTION public.increment_referral_reward_rides(p_rider_id uuid, p_driver_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_reward record;
    v_target smallint;
    v_reward_bps numeric;
    v_lifetime_cents bigint;
    v_payout_cents bigint;
    v_spend jsonb;
BEGIN
    SELECT COALESCE(value_cents, 5) INTO v_target FROM public.pricing_config WHERE key = 'RIDER_REFERRAL_TARGET_RIDES';
    v_target := COALESCE(v_target, 5);

    SELECT COALESCE(value_cents, 500) INTO v_reward_bps FROM public.pricing_config WHERE key = 'DRIVER_ONBOARD_REWARD_BPS';
    v_reward_bps := COALESCE(v_reward_bps, 500);

    INSERT INTO public.referral_rewards (rider_id, driver_id, target_rides)
    VALUES (p_rider_id, p_driver_id, v_target)
    ON CONFLICT (rider_id, driver_id) DO NOTHING;

    UPDATE public.referral_rewards
    SET rides_completed = rides_completed + 1, updated_at = now()
    WHERE rider_id = p_rider_id AND driver_id = p_driver_id AND reward_triggered = false
    RETURNING * INTO v_reward;

    IF v_reward IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Reward already triggered or not found');
    END IF;

    IF v_reward.rides_completed < v_target THEN
        RETURN jsonb_build_object('success', true, 'reward_triggered', false,
            'rides_completed', v_reward.rides_completed, 'rides_remaining', v_target - v_reward.rides_completed);
    END IF;

    -- Lifetime fare paid by this rider, across ALL completed rides to date.
    SELECT COALESCE(sum(total_fare_cents), 0) INTO v_lifetime_cents
    FROM public.rides WHERE rider_id = p_rider_id AND status = 'completed';

    v_payout_cents := ROUND(v_lifetime_cents * v_reward_bps / 10000.0);

    UPDATE public.referral_rewards SET reward_triggered = true WHERE id = v_reward.id;

    IF v_payout_cents <= 0 THEN
        RETURN jsonb_build_object('success', true, 'reward_triggered', true, 'payout_cents', 0,
            'rides_completed', v_reward.rides_completed);
    END IF;

    v_spend := public.spend_from_reserve('driver_onboard_reward', p_driver_id, v_payout_cents, p_rider_id,
        format('Driver onboarding reward — %s%% of rider lifetime fare (%s TTD) after %s rides',
               (v_reward_bps/100.0)::text, (v_lifetime_cents/100.0)::text, v_reward.rides_completed));

    RETURN jsonb_build_object('success', true, 'reward_triggered', true,
        'rides_completed', v_reward.rides_completed, 'payout_cents', v_payout_cents,
        'reserve_result', v_spend);
END;
$function$;

-- ─── 6. Rider-onboard reward: same mechanic, 3%, rider refers rider ──
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS referred_by_rider_id uuid REFERENCES public.profiles(id);

CREATE TABLE IF NOT EXISTS public.rider_referral_rewards (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_rider_id   uuid NOT NULL REFERENCES public.profiles(id),
    referee_rider_id    uuid NOT NULL REFERENCES public.profiles(id),
    rides_completed     smallint NOT NULL DEFAULT 0,
    target_rides        smallint NOT NULL DEFAULT 5,
    reward_triggered    boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (referrer_rider_id, referee_rider_id)
);
ALTER TABLE public.rider_referral_rewards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own rider referral rewards" ON public.rider_referral_rewards;
CREATE POLICY "Own rider referral rewards" ON public.rider_referral_rewards
    FOR SELECT USING (referrer_rider_id = auth.uid() OR referee_rider_id = auth.uid());

CREATE OR REPLACE FUNCTION public.increment_rider_referral_reward(p_referee_rider_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_referrer_id uuid;
    v_target smallint;
    v_reward_bps numeric;
    v_reward record;
    v_lifetime_cents bigint;
    v_payout_cents bigint;
    v_spend jsonb;
BEGIN
    SELECT referred_by_rider_id INTO v_referrer_id FROM public.profiles WHERE id = p_referee_rider_id;
    IF v_referrer_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'No rider referrer on this account');
    END IF;

    SELECT COALESCE(value_cents, 5) INTO v_target FROM public.pricing_config WHERE key = 'RIDER_REFERRAL_TARGET_RIDES';
    v_target := COALESCE(v_target, 5);
    SELECT COALESCE(value_cents, 300) INTO v_reward_bps FROM public.pricing_config WHERE key = 'RIDER_ONBOARD_REWARD_BPS';
    v_reward_bps := COALESCE(v_reward_bps, 300);

    INSERT INTO public.rider_referral_rewards (referrer_rider_id, referee_rider_id, target_rides)
    VALUES (v_referrer_id, p_referee_rider_id, v_target)
    ON CONFLICT (referrer_rider_id, referee_rider_id) DO NOTHING;

    UPDATE public.rider_referral_rewards
    SET rides_completed = rides_completed + 1, updated_at = now()
    WHERE referrer_rider_id = v_referrer_id AND referee_rider_id = p_referee_rider_id AND reward_triggered = false
    RETURNING * INTO v_reward;

    IF v_reward IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Reward already triggered or not found');
    END IF;

    IF v_reward.rides_completed < v_target THEN
        RETURN jsonb_build_object('success', true, 'reward_triggered', false,
            'rides_completed', v_reward.rides_completed, 'rides_remaining', v_target - v_reward.rides_completed);
    END IF;

    SELECT COALESCE(sum(total_fare_cents), 0) INTO v_lifetime_cents
    FROM public.rides WHERE rider_id = p_referee_rider_id AND status = 'completed';

    v_payout_cents := ROUND(v_lifetime_cents * v_reward_bps / 10000.0);

    UPDATE public.rider_referral_rewards SET reward_triggered = true WHERE id = v_reward.id;

    IF v_payout_cents <= 0 THEN
        RETURN jsonb_build_object('success', true, 'reward_triggered', true, 'payout_cents', 0);
    END IF;

    v_spend := public.spend_from_reserve('rider_onboard_reward', v_referrer_id, v_payout_cents, p_referee_rider_id,
        format('Friends & family reward — %s%% of referred rider lifetime fare (%s TTD) after %s rides',
               (v_reward_bps/100.0)::text, (v_lifetime_cents/100.0)::text, v_reward.rides_completed));

    RETURN jsonb_build_object('success', true, 'reward_triggered', true,
        'rides_completed', v_reward.rides_completed, 'payout_cents', v_payout_cents,
        'reserve_result', v_spend);
END;
$function$;

REVOKE ALL ON FUNCTION public.increment_referral_reward_rides(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_referral_reward_rides(uuid, uuid) TO service_role, authenticated;
REVOKE ALL ON FUNCTION public.increment_rider_referral_reward(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_rider_referral_reward(uuid) TO service_role, authenticated;

-- ─── 7. Set referred_by_rider_id at signup when a rider code is applied ─
CREATE OR REPLACE FUNCTION public.apply_referral_code(p_referee_id uuid, p_code text, p_type text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_referrer_id UUID;
    v_credit INTEGER := 1500; -- TTD $15.00 in cents
BEGIN
    SELECT user_id INTO v_referrer_id FROM referral_codes WHERE code = upper(p_code) AND type = p_type;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code'); END IF;
    IF v_referrer_id = p_referee_id THEN RETURN jsonb_build_object('success', false, 'error', 'Cannot use own code'); END IF;
    IF EXISTS (SELECT 1 FROM referral_earnings WHERE referee_id = p_referee_id AND type = p_type) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Referral already used');
    END IF;

    INSERT INTO wallet_transactions (user_id, amount, transaction_type, description, status)
    VALUES
        (v_referrer_id, v_credit, 'bonus', format('Referral bonus — new %s signup', p_type), 'completed'),
        (p_referee_id,  v_credit, 'bonus', 'Welcome bonus — referral code applied', 'completed');

    INSERT INTO referral_earnings (referrer_id, referee_id, type, amount_cents, status, expires_at)
    VALUES (v_referrer_id, p_referee_id, p_type, v_credit, 'paid', now() + interval '90 days');

    -- Rider-refers-rider: link the referee to the referrer so their ride
    -- completions can trigger the 3% lifetime-spend reward above.
    IF p_type = 'rider' THEN
        UPDATE profiles SET referred_by_rider_id = v_referrer_id WHERE id = p_referee_id AND referred_by_rider_id IS NULL;
    END IF;

    UPDATE referral_codes SET uses = uses + 1 WHERE code = upper(p_code);

    RETURN jsonb_build_object('success', true, 'referrer_id', v_referrer_id, 'credit_cents', v_credit);
END;
$function$;

NOTIFY pgrst, 'reload schema';
