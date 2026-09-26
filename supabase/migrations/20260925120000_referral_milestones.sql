-- ═══════════════════════════════════════════════════════════════════════════
-- Referral milestones — 2026-09-25 (pre-launch)
--
-- Replaces the dead driver-referral rule and adds the rider-referral reward
-- per the founder's approved referral economics:
--
--   DRIVER → DRIVER: when a referred driver completes their 25th qualifying
--     ride, the referrer (if NOT an active commander — no stacking with the
--     2% territory override) gets a one-time lump sum = 25% of the
--     platform's keep summed across those 25 rides, credited to wallet.
--     Replaces check_driver_referral_commission ("1% of platform fee for 90
--     days"), which was DEAD CODE — it queried referral_earnings for
--     status='active', a value the CHECK constraint forbids, so it could
--     never fire. Dropped below.
--
--   RIDER → RIDER: when a referred rider completes 10 qualifying rides OR 5
--     qualifying orders, the referrer gets a one-time 25%-off-next-ride
--     coupon (max TT$25 off, expires 60 days after issue), redeemable on
--     wallet rides. Drivers are always paid on the PRE-discount fare —
--     the platform absorbs the coupon delta.
--
-- Qualifying ride: status='completed', total_fare_cents > 0,
--   payment_status <> 'refunded'. Tips never enter the bounty base —
--   platform keep comes from compute_ride_split on fare+wait+surge only.
-- Qualifying order: status='delivered', total_cents > 0,
--   payment_status NOT IN ('refunded','failed','pending').
--
-- Idempotency: every counter is backed by a processed-entity set
-- (PRIMARY KEY on (referee, entity)) and every payout by an atomic
-- status transition (pending → paid). Retries can never double-count
-- or double-pay.
--
-- SCOPE NOTES (deliberately untouched):
--   * apply_referral_code's $15-both-sides signup bonus — live, unchanged.
--   * increment_rider_referral_reward (3% of lifetime fare from reserve
--     after 5 rides) — live, unchanged. It now STACKS with the coupon:
--     a referrer can earn the 3% at 5 rides AND the coupon at 10 rides.
--     Founder call needed on whether to keep both.
--   * increment_referral_reward_rides (driver-onboarded-rider 5%) — unchanged.
--   * Driver scout $500 hotel bounty + trg_auto_payout_scout_referral — untouched.
--   * compute_ride_split percentages, node/counter commission — untouched.
--   * progression_config seed: NOT seeded here. threshold_value,
--     unlock_vertical, threshold_type, push_title, push_body are NOT NULL
--     with no defaults, so seeding discount percents alone is impossible
--     without inventing threshold data (founder: thresholds undecided).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Progress + coupon tables
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.driver_referral_progress (
    referee_id          uuid PRIMARY KEY,   -- referred DRIVER's auth user id
    referrer_id         uuid NOT NULL,      -- referring driver's auth user id
    rides_completed     integer NOT NULL DEFAULT 0,
    platform_keep_cents bigint NOT NULL DEFAULT 0,  -- running sum of platform_fee
    status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','paid','skipped_commander')),
    bounty_cents        integer,            -- set at payout
    created_at          timestamptz NOT NULL DEFAULT now(),
    paid_at             timestamptz
);

-- Processed-ride set: the idempotency backbone. A ride is counted at most
-- once no matter how many times complete_ride (or a retry) fires.
CREATE TABLE IF NOT EXISTS public.driver_referral_progress_rides (
    referee_id          uuid NOT NULL REFERENCES public.driver_referral_progress(referee_id) ON DELETE CASCADE,
    ride_id             uuid NOT NULL,
    platform_fee_cents  integer NOT NULL,
    counted_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (referee_id, ride_id)
);

CREATE TABLE IF NOT EXISTS public.rider_referral_progress (
    referee_id          uuid PRIMARY KEY,   -- referred RIDER's auth user id
    referrer_id         uuid NOT NULL,      -- referring rider's auth user id
    rides_completed     integer NOT NULL DEFAULT 0,
    orders_completed    integer NOT NULL DEFAULT 0,
    coupon_issued       boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    rewarded_at         timestamptz
);

CREATE TABLE IF NOT EXISTS public.rider_referral_progress_entities (
    referee_id          uuid NOT NULL REFERENCES public.rider_referral_progress(referee_id) ON DELETE CASCADE,
    kind                text NOT NULL CHECK (kind IN ('ride','order')),
    entity_id           uuid NOT NULL,
    counted_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (referee_id, kind, entity_id)
);

CREATE TABLE IF NOT EXISTS public.rider_referral_coupons (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_user_id       uuid NOT NULL,      -- the REFERRER who earned it
    referee_id          uuid NOT NULL UNIQUE, -- one coupon per successful referral
    percent_off         integer NOT NULL DEFAULT 25,
    max_discount_cents  integer NOT NULL DEFAULT 2500,  -- TT$25 cap
    status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','issued','used','expired')),
    issued_at           timestamptz,
    expires_at          timestamptz NOT NULL DEFAULT (now() + interval '60 days'),
    used_ride_id        uuid,
    used_at             timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rider_referral_coupons_user_status
    ON public.rider_referral_coupons (rider_user_id, status);

-- RLS: users can read their own referral progress/coupons; all writes go
-- through service_role RPCs / edge functions (no INSERT/UPDATE policies).
ALTER TABLE public.driver_referral_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_referral_progress_rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rider_referral_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rider_referral_progress_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rider_referral_coupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own driver referral progress" ON public.driver_referral_progress;
CREATE POLICY "Own driver referral progress" ON public.driver_referral_progress
    FOR SELECT USING (referrer_id = auth.uid() OR referee_id = auth.uid());
DROP POLICY IF EXISTS "Own driver referral progress rides" ON public.driver_referral_progress_rides;
CREATE POLICY "Own driver referral progress rides" ON public.driver_referral_progress_rides
    FOR SELECT USING (
        referee_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.driver_referral_progress p
                   WHERE p.referee_id = driver_referral_progress_rides.referee_id
                     AND p.referrer_id = auth.uid())
    );
DROP POLICY IF EXISTS "Own rider referral progress" ON public.rider_referral_progress;
CREATE POLICY "Own rider referral progress" ON public.rider_referral_progress
    FOR SELECT USING (referrer_id = auth.uid() OR referee_id = auth.uid());
DROP POLICY IF EXISTS "Own rider referral progress entities" ON public.rider_referral_progress_entities;
CREATE POLICY "Own rider referral progress entities" ON public.rider_referral_progress_entities
    FOR SELECT USING (
        referee_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.rider_referral_progress p
                   WHERE p.referee_id = rider_referral_progress_entities.referee_id
                     AND p.referrer_id = auth.uid())
    );
DROP POLICY IF EXISTS "Own rider referral coupons" ON public.rider_referral_coupons;
CREATE POLICY "Own rider referral coupons" ON public.rider_referral_coupons
    FOR SELECT USING (rider_user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Driver → driver milestone bounty
--    25th qualifying ride → 25% of platform keep across the 25 rides.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.award_driver_referral_milestone(
    p_driver_user_id uuid,
    p_ride_id uuid,
    p_platform_fee_cents integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_referrer_id   uuid;
    v_rowcount      integer;
    v_prog          record;
    v_bounty        integer;
    v_is_commander  boolean;
BEGIN
    -- Resolve the referrer from the signup-time referral record. The old
    -- dead rule is gone; the referral_earnings row (status='paid', the $15
    -- signup bonus) remains the canonical link between referrer/referee.
    SELECT referrer_id INTO v_referrer_id
    FROM public.referral_earnings
    WHERE referee_id = p_driver_user_id AND type = 'driver'
    LIMIT 1;
    IF v_referrer_id IS NULL OR v_referrer_id = p_driver_user_id THEN
        RETURN 0;
    END IF;

    -- Ensure the progress row exists (idempotent; pins the referrer).
    INSERT INTO public.driver_referral_progress (referee_id, referrer_id)
    VALUES (p_driver_user_id, v_referrer_id)
    ON CONFLICT (referee_id) DO NOTHING;

    -- Safety net: only qualifying rides count. (complete_ride calls this
    -- post-payment, so this is normally already true.)
    PERFORM 1 FROM public.rides
    WHERE id = p_ride_id
      AND status = 'completed'
      AND COALESCE(total_fare_cents, 0) > 0
      AND payment_status <> 'refunded';
    IF NOT FOUND THEN
        RETURN 0;
    END IF;

    -- Idempotent per-ride counting: the PRIMARY KEY on
    -- (referee_id, ride_id) makes double-counting impossible.
    INSERT INTO public.driver_referral_progress_rides (referee_id, ride_id, platform_fee_cents)
    VALUES (p_driver_user_id, p_ride_id, GREATEST(COALESCE(p_platform_fee_cents, 0), 0))
    ON CONFLICT (referee_id, ride_id) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount = 0 THEN
        RETURN 0;  -- already counted
    END IF;

    -- Bump counters. Frozen once paid/skipped (status guard).
    UPDATE public.driver_referral_progress
    SET rides_completed = rides_completed + 1,
        platform_keep_cents = platform_keep_cents + GREATEST(COALESCE(p_platform_fee_cents, 0), 0)
    WHERE referee_id = p_driver_user_id AND status = 'pending'
    RETURNING * INTO v_prog;
    IF NOT FOUND THEN
        RETURN 0;  -- already paid or skipped
    END IF;

    IF v_prog.rides_completed < 25 THEN
        RETURN 0;
    END IF;

    -- Commander exclusion: an active G-Lead already earns the 2% territory
    -- override on these rides — the milestone never stacks on top of it.
    SELECT EXISTS (
        SELECT 1 FROM public.pod_commanders
        WHERE user_id = v_referrer_id AND status = 'active'
    ) INTO v_is_commander;
    IF v_is_commander THEN
        UPDATE public.driver_referral_progress
        SET status = 'skipped_commander'
        WHERE referee_id = p_driver_user_id AND status = 'pending';
        RETURN 0;
    END IF;

    -- 25% of the platform's keep across the 25 rides, floored to the cent.
    -- The platform keeps ~18.5% of gross, so this is ~4.6% of gross fare —
    -- always payable out of what the platform actually earned.
    v_bounty := FLOOR(v_prog.platform_keep_cents * 0.25)::integer;

    -- Atomic pay transition: concurrent completions race here; exactly one
    -- wins the pending → paid flip, the loser pays nothing.
    UPDATE public.driver_referral_progress
    SET status = 'paid', paid_at = now(), bounty_cents = v_bounty
    WHERE referee_id = p_driver_user_id AND status = 'pending';
    IF NOT FOUND THEN
        RETURN 0;
    END IF;

    IF v_bounty > 0 THEN
        INSERT INTO public.wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
        VALUES (v_referrer_id, p_ride_id, v_bounty, 'bonus',
                format('Driver referral milestone — 25%% of platform keep on first %s rides (%s TTD platform keep)',
                       v_prog.rides_completed, (v_prog.platform_keep_cents / 100.0)::text),
                'completed');
        INSERT INTO public.wallets (user_id, balance_cents)
        VALUES (v_referrer_id, v_bounty)
        ON CONFLICT (user_id) DO UPDATE
            SET balance_cents = wallets.balance_cents + EXCLUDED.balance_cents,
                updated_at = now();
    END IF;

    RETURN v_bounty;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.award_driver_referral_milestone(uuid, uuid, integer) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.award_driver_referral_milestone(uuid, uuid, integer) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Rider → rider milestone: 10 rides OR 5 orders → 25%-off coupon
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.award_rider_referral_milestone(
    p_referee_id uuid,
    p_kind text,
    p_entity_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_referrer_id uuid;
    v_rowcount    integer;
    v_prog        record;
    v_coupon_id   uuid;
BEGIN
    IF p_kind NOT IN ('ride', 'order') THEN
        RETURN jsonb_build_object('success', false, 'message', 'kind must be ride|order');
    END IF;

    -- Canonical link is the signup-time referral_earnings row; fall back to
    -- profiles.referred_by_rider_id (set by the same signup flow).
    SELECT referrer_id INTO v_referrer_id
    FROM public.referral_earnings
    WHERE referee_id = p_referee_id AND type = 'rider'
    LIMIT 1;
    IF v_referrer_id IS NULL THEN
        SELECT referred_by_rider_id INTO v_referrer_id
        FROM public.profiles WHERE id = p_referee_id;
    END IF;
    IF v_referrer_id IS NULL OR v_referrer_id = p_referee_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'no rider referrer');
    END IF;

    INSERT INTO public.rider_referral_progress (referee_id, referrer_id)
    VALUES (p_referee_id, v_referrer_id)
    ON CONFLICT (referee_id) DO NOTHING;

    -- Qualifying-entity verification. Rides: completed, positive fare, not
    -- refunded. Orders: delivered, positive total, payment not failed/
    -- refunded/pending (cash_on_delivery counts — cash is collected).
    IF p_kind = 'ride' THEN
        PERFORM 1 FROM public.rides
        WHERE id = p_entity_id
          AND rider_id = p_referee_id
          AND status = 'completed'
          AND COALESCE(total_fare_cents, 0) > 0
          AND payment_status <> 'refunded';
    ELSE
        PERFORM 1 FROM public.orders
        WHERE id = p_entity_id
          AND rider_id = p_referee_id
          AND status = 'delivered'
          AND COALESCE(total_cents, 0) > 0
          AND payment_status NOT IN ('refunded', 'failed', 'pending');
    END IF;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'entity not qualifying');
    END IF;

    -- Idempotent counting: PRIMARY KEY (referee_id, kind, entity_id).
    INSERT INTO public.rider_referral_progress_entities (referee_id, kind, entity_id)
    VALUES (p_referee_id, p_kind, p_entity_id)
    ON CONFLICT (referee_id, kind, entity_id) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount = 0 THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true);
    END IF;

    UPDATE public.rider_referral_progress
    SET rides_completed  = rides_completed  + CASE WHEN p_kind = 'ride'  THEN 1 ELSE 0 END,
        orders_completed = orders_completed + CASE WHEN p_kind = 'order' THEN 1 ELSE 0 END
    WHERE referee_id = p_referee_id AND coupon_issued = false
    RETURNING * INTO v_prog;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', true, 'already_rewarded', true);
    END IF;

    IF v_prog.rides_completed < 10 AND v_prog.orders_completed < 5 THEN
        RETURN jsonb_build_object('success', true, 'rewarded', false,
            'rides_completed', v_prog.rides_completed,
            'orders_completed', v_prog.orders_completed);
    END IF;

    -- Issue exactly one coupon per referee. UNIQUE(referee_id) is the
    -- idempotency guard — concurrent milestones race here, one wins.
    INSERT INTO public.rider_referral_coupons
        (rider_user_id, referee_id, status, issued_at, expires_at)
    VALUES (v_referrer_id, p_referee_id, 'issued', now(), now() + interval '60 days')
    ON CONFLICT (referee_id) DO NOTHING
    RETURNING id INTO v_coupon_id;

    UPDATE public.rider_referral_progress
    SET coupon_issued = true, rewarded_at = now()
    WHERE referee_id = p_referee_id;

    RETURN jsonb_build_object('success', true, 'rewarded', true, 'coupon_id', v_coupon_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.award_rider_referral_milestone(uuid, text, uuid) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.award_rider_referral_milestone(uuid, text, uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Order-completion hook: fires on the delivered transition no matter
--    which path completed the order (process_order_delivery_payment via
--    grocery/process_stop_arrival, or verify_handoff). Follows the
--    trg_scout_on_order_complete pattern: bookkeeping can NEVER block
--    or roll back the underlying delivery.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rider_referral_on_order_delivered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  BEGIN
    PERFORM public.award_rider_referral_milestone(NEW.rider_id, 'order', NEW.id);
  EXCEPTION WHEN OTHERS THEN
    -- swallow: never block an order delivery on referral bookkeeping
    NULL;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rider_referral_on_order_delivered ON public.orders;
CREATE TRIGGER trg_rider_referral_on_order_delivered
AFTER UPDATE ON public.orders
FOR EACH ROW
WHEN (
  NEW.status = 'delivered'
  AND OLD.status IS DISTINCT FROM 'delivered'
)
EXECUTE FUNCTION public.rider_referral_on_order_delivered();

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Drop the dead driver-referral rule it replaces
-- ─────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.check_driver_referral_commission(uuid, uuid, integer);
-- ─────────────────────────────────────────────────────────────────────────
-- 6. Wallet settlement learns the coupon (mechanical extension of the
--    20260815 loyalty-rate pattern)
--
-- process_wallet_payment_hardened gains two OPTIONAL params:
--   p_coupon_id uuid DEFAULT NULL, p_coupon_discount_cents integer DEFAULT 0
-- Existing call sites (admin, confirm_nfc_payment, wipay settlements) pass
-- nothing -> NULL/0 -> byte-identical behavior to before.
--
-- DROP+CREATE is required (Postgres cannot add params to an existing
-- function), so the PUBLIC-grant gap this opens is closed with the same
-- REVOKE/GRANT treatment as 20260815000004.
--
-- Settlement math with a coupon (rider pays 75%, capped at TT$25):
--   driver is paid v_driver_net (PRE-discount split — untouched)
--   rider is debited p_amount - discount_applied - coupon
--   platform books commission_fee = v_platform_fee (as before) and a
--     SEPARATE promo_cost = -coupon, so the coupon delta is visible in
--     the platform ledger and never leaks into driver/commander/reserve.
-- ─────────────────────────────────────────────────────────────────────────

DROP FUNCTION public.process_wallet_payment_hardened(uuid, integer, text, integer, integer);

CREATE FUNCTION public.process_wallet_payment_hardened(
  p_ride_id uuid,
  p_amount integer,
  p_idempotency_key text DEFAULT NULL,
  p_discount_cents integer DEFAULT 0,
  p_loyalty_rate_bps int DEFAULT NULL,
  p_coupon_id uuid DEFAULT NULL,
  p_coupon_discount_cents integer DEFAULT 0
)
RETURNS TABLE(success boolean, error_message text, transaction_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_rider_id UUID; v_driver_id UUID; v_driver_uid UUID;
    v_platform_id UUID := '00000000-0000-0000-0000-000000000000';
    v_payment_status TEXT; v_ride_status TEXT; v_balance INTEGER;
    v_advisory_lock_id BIGINT; v_txn_id UUID := gen_random_uuid(); v_split jsonb;
    v_driver_net INTEGER; v_platform_fee INTEGER; v_reserve INTEGER;
    v_discount_applied INTEGER; v_actual_debit INTEGER;
    v_coupon INTEGER := 0;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN QUERY SELECT FALSE,'Invalid amount: must be positive',NULL::UUID; RETURN; END IF;
    IF p_ride_id IS NULL THEN
        RETURN QUERY SELECT FALSE,'Ride ID is required',NULL::UUID; RETURN; END IF;
    IF p_discount_cents IS NULL OR p_discount_cents < 0 THEN p_discount_cents := 0; END IF;

    v_advisory_lock_id := ('x'||substr(md5(p_ride_id::text),1,16))::bit(64)::bigint;
    IF NOT pg_try_advisory_xact_lock(v_advisory_lock_id) THEN
        RETURN QUERY SELECT FALSE,'Ride is being processed by another request',NULL::UUID; RETURN; END IF;

    SELECT r.rider_id,r.driver_id,r.payment_status,r.status
      INTO v_rider_id,v_driver_id,v_payment_status,v_ride_status
      FROM public.rides r WHERE r.id=p_ride_id FOR UPDATE;
    IF v_rider_id IS NULL THEN RETURN QUERY SELECT FALSE,'Ride not found',NULL::UUID; RETURN; END IF;
    IF v_driver_id IS NULL THEN RETURN QUERY SELECT FALSE,'Ride has no assigned driver',NULL::UUID; RETURN; END IF;
    IF v_ride_status NOT IN ('assigned','arrived','in_progress','completed') THEN
        RETURN QUERY SELECT FALSE,format('Cannot process payment for ride in %s status',v_ride_status),NULL::UUID; RETURN; END IF;
    IF v_payment_status='captured' THEN
        RETURN QUERY SELECT TRUE,'Payment already processed',v_txn_id; RETURN; END IF;
    IF EXISTS (SELECT 1 FROM public.wallet_transactions
               WHERE ride_id=p_ride_id AND transaction_type='ride_payment' AND amount<0) THEN
        UPDATE public.rides SET payment_status='captured',updated_at=NOW() WHERE id=p_ride_id;
        RETURN QUERY SELECT TRUE,'Payment already processed (state repaired)',v_txn_id; RETURN; END IF;

    SELECT user_id INTO v_driver_uid FROM public.drivers WHERE id=v_driver_id;
    IF v_driver_uid IS NULL THEN
        RETURN QUERY SELECT FALSE,'Driver account not found for settlement',NULL::UUID; RETURN; END IF;

    v_split := public.compute_ride_split(p_ride_id,p_amount,p_discount_cents,p_loyalty_rate_bps);
    v_driver_net:=(v_split->>'driver_net')::integer;
    v_platform_fee:=(v_split->>'platform_fee')::integer;
    v_reserve:=(v_split->>'reserve')::integer;
    v_discount_applied:=(v_split->>'discount_applied')::integer;
    -- REFERRAL-MILESTONE 2026-09-25: one-time 25%-off referral coupon.
    -- Consumed atomically (issued->used on the exact coupon row) so a
    -- double payment / retry can never redeem it twice. Driver payout
    -- (v_driver_net) is computed on the PRE-discount gross, so the driver
    -- is always paid on the full fare; the platform absorbs the coupon.
    IF p_coupon_id IS NOT NULL AND COALESCE(p_coupon_discount_cents,0)>0 THEN
        UPDATE public.rider_referral_coupons
        SET status='used',used_ride_id=p_ride_id,used_at=NOW()
        WHERE id=p_coupon_id
          AND status='issued'
          AND expires_at>NOW()
          AND rider_user_id=v_rider_id;
        IF FOUND THEN
            v_coupon:=LEAST(COALESCE(p_coupon_discount_cents,0),p_amount);
        ELSE
            SELECT CASE WHEN status='used' AND used_ride_id=p_ride_id
                        THEN LEAST(COALESCE(p_coupon_discount_cents,0),p_amount)
                        ELSE 0 END
              INTO v_coupon
              FROM public.rider_referral_coupons WHERE id=p_coupon_id;
            v_coupon:=COALESCE(v_coupon,0);
        END IF;
    END IF;
    v_actual_debit:=p_amount-v_discount_applied-v_coupon;

    v_advisory_lock_id := ('x'||substr(md5(v_rider_id::text),1,16))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(v_advisory_lock_id);
    SELECT COALESCE(SUM(amount),0) INTO v_balance FROM public.wallet_transactions WHERE user_id=v_rider_id;
    IF v_balance < v_actual_debit THEN
        RETURN QUERY SELECT FALSE,format('Insufficient balance: %s cents available, %s cents required',v_balance,v_actual_debit),NULL::UUID; RETURN; END IF;

    BEGIN
        INSERT INTO public.wallet_transactions (id,user_id,ride_id,amount,transaction_type,description,status,reference_id)
        VALUES (gen_random_uuid(),v_rider_id,p_ride_id,-v_actual_debit,'ride_payment',
                CASE WHEN v_discount_applied>0 OR v_coupon>0 THEN format('Ride payment (wallet) — %s cents loyalty discount applied, %s cents referral coupon applied',v_discount_applied,v_coupon)
                     ELSE 'Ride payment (wallet)' END,'completed',p_idempotency_key);
    EXCEPTION WHEN unique_violation THEN
        IF EXISTS (SELECT 1 FROM public.wallet_transactions
                   WHERE ride_id=p_ride_id AND user_id=v_rider_id
                     AND transaction_type='ride_payment' AND amount=-v_actual_debit) THEN
            UPDATE public.rides SET payment_status='captured',updated_at=NOW() WHERE id=p_ride_id;
            RETURN QUERY SELECT TRUE,'Payment already processed (duplicate request)',v_txn_id; RETURN;
        ELSE RAISE; END IF;
    END;

    INSERT INTO public.wallet_transactions (id,user_id,ride_id,amount,transaction_type,description,status)
    VALUES (gen_random_uuid(),v_driver_uid,p_ride_id,v_driver_net,'driver_payout','Ride earnings (wallet)','completed');
    INSERT INTO public.wallet_transactions (id,user_id,ride_id,amount,transaction_type,description,status)
    VALUES (gen_random_uuid(),v_platform_id,p_ride_id,v_platform_fee,'commission_fee','Platform commission (wallet ride)','completed');
    IF v_coupon>0 THEN
        INSERT INTO public.wallet_transactions (id,user_id,ride_id,amount,transaction_type,description,status)
        VALUES (gen_random_uuid(),v_platform_id,p_ride_id,-v_coupon,'promo_cost','Referral coupon absorbed by platform (25% off, TT$25 cap)','completed');
    END IF;
    IF v_reserve>0 THEN PERFORM public.post_reserve_contribution(p_ride_id,v_reserve,'ride'); END IF;
    PERFORM public.record_ride_kickbacks(p_ride_id,v_rider_id,p_amount,v_split);
    INSERT INTO public.payment_ledger (id,ride_id,user_id,amount,currency,status,provider,metadata)
    VALUES (gen_random_uuid(),p_ride_id,v_rider_id,(v_actual_debit/100.0),'TTD','captured','wallet',
            jsonb_build_object('idempotency_key',p_idempotency_key,'discount_applied_cents',v_discount_applied,'coupon_id',p_coupon_id,'coupon_discount_cents',v_coupon));
    UPDATE public.rides SET payment_status='captured',updated_at=NOW(),
        total_fare_cents=COALESCE(total_fare_cents,p_amount),
        driver_payout_cents=v_driver_net,platform_fee_cents=v_platform_fee,reserve_cents=v_reserve
    WHERE id=p_ride_id;
    RETURN QUERY SELECT TRUE,NULL::TEXT,v_txn_id;
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT FALSE,SQLERRM,NULL::UUID;
END;
$function$;


GRANT EXECUTE ON FUNCTION public.process_wallet_payment_hardened(uuid, integer, text, integer, integer, uuid, integer) TO service_role, postgres;

-- ── SECURITY: close the PUBLIC-grant gap this migration's own DROP+CREATE
-- opened (same root cause documented in 20260815000003/20260815000004) ──
REVOKE EXECUTE ON FUNCTION public.process_wallet_payment_hardened(uuid, integer, text, integer, integer, uuid, integer) FROM PUBLIC, authenticated, anon;
