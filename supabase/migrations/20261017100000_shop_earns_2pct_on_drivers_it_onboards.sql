-- ═══════════════════════════════════════════════════════════════════
-- G-Partner (shop) earns 2% of the fares of drivers it onboards
-- (founder decision, 2026-10-17).
--
-- Rules (founder: "Driver's 80%, one recruiter"):
--   * The 2% comes out of the driver's 80% pool, exactly like a G-Lead's
--     2%. The platform's share does not change.
--   * A driver has ONE recruiter: a shop OR a G-Lead, never both
--     (drivers_one_recruiter). So a driver never drops below 78%.
--   * The shop earns only while it is an active G-Partner (is_active and
--     activation_status = 'active' and has an owner login). Otherwise the
--     driver keeps the 2%, same as when a G-Lead stops being active.
--   * "Onboards" = the driver entered the shop's code before their first
--     completed ride. A shop cannot claim an existing working driver.
--   * Moving to a G-Lead network later is allowed after 30 days, the same
--     lock the network system already uses; the shop link is then cleared
--     and the shop stops earning on that driver.
--
-- What this adds:
--   SHOP_RECRUITER_RATE_CENTS        pricing_config, 200 = 2%
--   drivers.recruited_by_merchant_id / recruited_by_merchant_at
--   merchants.driver_invite_code     the code a shop hands to drivers
--   shop_recruiter_revshare_ledger   one 'pending' row per ride, like
--                                    commander_revshare_ledger
--   compute_ride_split               new shop_recruiter_cut (from the driver pool)
--   record_ride_kickbacks            writes the ledger row (all payment methods)
--   estimate_offer_driver_payout     offers show the real 78%
--   driver_join_shop(code)           driver links to a shop
--   merchant_driver_network()        shop owner sees code + earnings
--   request_network_join / decide_network_join   respect the one-recruiter rule
--   driver protection triggers       nobody can set the shop link directly
--
-- NOT included: paying the pending ledger out to the shop's wallet. Same
-- as commander_revshare_ledger today, it is recorded 'pending' and needs a
-- payout step (admin cash-out or a credit_merchant_commission-style job).
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO public.pricing_config (key, value_cents, description, updated_at)
VALUES ('SHOP_RECRUITER_RATE_CENTS', 200,
        'G-Partner (shop) share of the fare, as bps, on rides by a driver the shop onboarded. Carved from the driver pool (driver 80% -> 78%), only while the shop is an active G-Partner. A driver has one recruiter: a shop or a G-Lead.',
        now())
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS recruited_by_merchant_id uuid REFERENCES public.merchants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recruited_by_merchant_at timestamptz;

ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_one_recruiter
  CHECK (recruited_by_commander_user_id IS NULL OR recruited_by_merchant_id IS NULL);

CREATE INDEX IF NOT EXISTS drivers_recruited_by_merchant_idx
  ON public.drivers (recruited_by_merchant_id) WHERE recruited_by_merchant_id IS NOT NULL;

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS driver_invite_code text UNIQUE;

CREATE TABLE IF NOT EXISTS public.shop_recruiter_revshare_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  merchant_owner_id uuid NOT NULL REFERENCES auth.users(id),
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  ride_id uuid NOT NULL UNIQUE REFERENCES public.rides(id),
  rider_id uuid,
  fare_cents bigint NOT NULL,
  revshare_cents bigint NOT NULL CHECK (revshare_cents >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'void')),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);

ALTER TABLE public.shop_recruiter_revshare_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shop_recruiter_revshare_ledger FROM anon, authenticated;
GRANT SELECT ON public.shop_recruiter_revshare_ledger TO authenticated;

CREATE POLICY "Shop owner reads own driver revshare" ON public.shop_recruiter_revshare_ledger
  FOR SELECT TO authenticated USING (merchant_owner_id = auth.uid());
CREATE POLICY "Admins read shop driver revshare" ON public.shop_recruiter_revshare_ledger
  FOR SELECT TO authenticated USING (public.auth_is_admin());

-- ── Driver protection: the shop link is network attribution ──────────
CREATE OR REPLACE FUNCTION public.protect_driver_sensitive_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  -- Service role (edge functions, admin tools) may change anything.
  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.commission_tier       IS DISTINCT FROM OLD.commission_tier
  OR NEW.custom_commission_rate IS DISTINCT FROM OLD.custom_commission_rate
  OR NEW.is_bot                IS DISTINCT FROM OLD.is_bot
  OR NEW.is_verified           IS DISTINCT FROM OLD.is_verified
  OR NEW.verified_status       IS DISTINCT FROM OLD.verified_status
  OR NEW.fleet_lease_id        IS DISTINCT FROM OLD.fleet_lease_id
  OR NEW.region_id             IS DISTINCT FROM OLD.region_id
  OR NEW.spoof_flag_count      IS DISTINCT FROM OLD.spoof_flag_count
  OR NEW.spoof_suspended       IS DISTINCT FROM OLD.spoof_suspended
  OR NEW.acceptance_rate       IS DISTINCT FROM OLD.acceptance_rate
  OR NEW.user_id               IS DISTINCT FROM OLD.user_id
  OR NEW.credit_limit_cents    IS DISTINCT FROM OLD.credit_limit_cents
  OR NEW.credit_used_cents     IS DISTINCT FROM OLD.credit_used_cents
  THEN
    RAISE EXCEPTION 'Direct modification of protected driver columns is not permitted';
  END IF;

  -- Network attribution (G-Lead or shop): only decide_network_join() and
  -- driver_join_shop() may move it.
  IF (NEW.recruited_by_commander_user_id IS DISTINCT FROM OLD.recruited_by_commander_user_id
      OR NEW.recruited_at IS DISTINCT FROM OLD.recruited_at
      OR NEW.recruited_by_merchant_id IS DISTINCT FROM OLD.recruited_by_merchant_id
      OR NEW.recruited_by_merchant_at IS DISTINCT FROM OLD.recruited_by_merchant_at)
     AND coalesce(current_setting('gtaxi.network_move', true), '') <> 'on' THEN
    RAISE EXCEPTION 'A driver''s network can only change through a network join request';
  END IF;

  -- Rating: only refresh_driver_rating() (fired by a rider's rating) may set it.
  IF (NEW.rating IS DISTINCT FROM OLD.rating OR NEW.rating_count IS DISTINCT FROM OLD.rating_count)
     AND coalesce(current_setting('gtaxi.rating_refresh', true), '') <> 'on' THEN
    RAISE EXCEPTION 'A driver''s rating can only change through rider ratings';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_driver_sensitive_columns_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  NEW.verified_status := CASE WHEN NEW.verified_status::text IN ('unverified', 'pending')
                              THEN NEW.verified_status ELSE 'unverified'::driver_verified_status END;
  NEW.is_verified                    := false;
  NEW.commission_tier                := 'standard'::driver_commission_tier;
  NEW.custom_commission_rate         := NULL;
  NEW.is_bot                         := false;
  NEW.fleet_lease_id                 := NULL;
  NEW.region_id                      := NULL;
  NEW.spoof_flag_count               := 0;
  NEW.spoof_flagged_at               := NULL;
  NEW.spoof_suspended                := false;
  NEW.acceptance_rate                := 0.80;
  NEW.credit_limit_cents             := 60000;
  NEW.credit_used_cents              := 0;
  NEW.rating                         := NULL;
  NEW.rating_count                   := 0;
  NEW.rank                           := 'driver'::driver_rank;
  NEW.registration_class             := 'unverified';
  NEW.registration_verified_at       := NULL;
  NEW.registration_verified_by       := NULL;
  NEW.recruited_by_commander_user_id := NULL;
  NEW.recruited_at                   := NULL;
  NEW.recruited_by_merchant_id       := NULL;
  NEW.recruited_by_merchant_at       := NULL;
  NEW.territory_id                   := NULL;
  NEW.territory_joined_at            := NULL;
  NEW.is_online                      := false;
  NEW.status                         := 'offline';
  NEW.active_ride_id                 := NULL;
  RETURN NEW;
END;
$function$;

-- ── The split: single source of truth ────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_ride_split(p_ride_id uuid, p_gross_cents bigint, p_discount_cents bigint DEFAULT 0, p_loyalty_rate_bps integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_driver_bps int; v_reserve_bps int; v_commander_bps int; v_node_bps int; v_platform_std_bps int; v_shop_bps int;
  v_driver_pool bigint; v_reserve bigint; v_commander_cut bigint := 0; v_vendor_cut bigint := 0; v_shop_cut bigint := 0;
  v_driver_net bigint; v_platform_raw bigint; v_platform_fee bigint; v_discount_applied bigint;
  v_loyalty_bonus bigint := 0;
  v_driver_id uuid; v_driver_uid uuid; v_recruiter_uid uuid; v_recruiter_shop uuid;
  v_commander_id uuid; v_commander_user_id uuid; v_node_id uuid; v_merchant_id uuid;
  v_shop_id uuid; v_shop_owner_id uuid;
BEGIN
  IF p_gross_cents IS NULL OR p_gross_cents <= 0 THEN
    RETURN jsonb_build_object('driver_net',0,'commander_cut',0,'vendor_cut',0,'reserve',0,
      'platform_fee',0,'discount_applied',0,'loyalty_bonus',0,'net_collected',0,'commander_id',NULL,'commander_user_id',NULL,'merchant_id',NULL,'node_id',NULL,
      'shop_recruiter_cut',0,'shop_recruiter_merchant_id',NULL,'shop_recruiter_owner_id',NULL);
  END IF;
  SELECT
    COALESCE(MAX(CASE WHEN key='DRIVER_SHARE_CENTS' THEN value_cents END),8000),
    COALESCE(MAX(CASE WHEN key='RESERVE_RATE_CENTS' THEN value_cents END),150),
    COALESCE(MAX(CASE WHEN key='COMMANDER_REVSHARE_RATE_CENTS' THEN value_cents END),200),
    COALESCE(MAX(CASE WHEN key='NODE_COMMISSION_RATE_ON_PLATFORM_BPS' THEN value_cents END),200),
    COALESCE(MAX(CASE WHEN key='PLATFORM_RATE_CENTS' THEN value_cents END),1500),
    COALESCE(MAX(CASE WHEN key='SHOP_RECRUITER_RATE_CENTS' THEN value_cents END),200)
  INTO v_driver_bps, v_reserve_bps, v_commander_bps, v_node_bps, v_platform_std_bps, v_shop_bps
  FROM public.pricing_config WHERE key IN ('DRIVER_SHARE_CENTS','RESERVE_RATE_CENTS','COMMANDER_REVSHARE_RATE_CENTS','NODE_COMMISSION_RATE_ON_PLATFORM_BPS','PLATFORM_RATE_CENTS','SHOP_RECRUITER_RATE_CENTS');

  v_driver_pool := ROUND(p_gross_cents * v_driver_bps / 10000.0);
  v_reserve     := ROUND(p_gross_cents * v_reserve_bps / 10000.0);

  SELECT driver_id, vendor_node_id INTO v_driver_id, v_node_id FROM public.rides WHERE id = p_ride_id;
  SELECT user_id, recruited_by_commander_user_id, recruited_by_merchant_id
    INTO v_driver_uid, v_recruiter_uid, v_recruiter_shop
    FROM public.drivers WHERE id = v_driver_id;
  IF v_driver_uid IS NULL THEN v_driver_uid := v_driver_id; END IF;

  -- Pay follows the RECRUITER, not the territory, and only for as long as
  -- that recruiter is still an active commander. No recruiter, or a recruiter
  -- who has handed off / been suspended / left => commander_cut 0 and the
  -- driver keeps the whole 80% pool. Deliberately does NOT look at
  -- drivers.territory_id: a new commander inherits nobody, and zone
  -- notifications (which DO use territory_id) stay a separate lookup.
  IF v_recruiter_uid IS NOT NULL THEN
    SELECT id, user_id INTO v_commander_id, v_commander_user_id
    FROM public.pod_commanders WHERE user_id = v_recruiter_uid AND status = 'active' LIMIT 1;
  END IF;

  IF v_commander_id IS NOT NULL THEN
    v_commander_cut := ROUND(p_gross_cents * v_commander_bps / 10000.0);
  ELSIF v_recruiter_shop IS NOT NULL THEN
    -- Shop recruiter (one recruiter per driver: drivers_one_recruiter), same
    -- rule as a G-Lead: only while the shop is an active G-Partner with an
    -- owner login; otherwise the driver keeps the whole pool.
    SELECT m.id, m.created_by INTO v_shop_id, v_shop_owner_id
      FROM public.merchants m
     WHERE m.id = v_recruiter_shop
       AND COALESCE(m.is_active, false)
       AND m.activation_status = 'active'
       AND m.created_by IS NOT NULL;
    IF v_shop_id IS NOT NULL THEN
      v_shop_cut := ROUND(p_gross_cents * v_shop_bps / 10000.0);
    END IF;
  END IF;
  v_driver_net := v_driver_pool - v_commander_cut - v_shop_cut;

  v_platform_raw := p_gross_cents - v_driver_net - v_commander_cut - v_shop_cut - v_reserve;

  IF v_node_id IS NOT NULL THEN
    SELECT merchant_id INTO v_merchant_id FROM public.kiosk_nodes WHERE id = v_node_id;
    IF v_merchant_id IS NOT NULL AND v_platform_raw > 0 THEN
      v_vendor_cut := ROUND(v_platform_raw * v_node_bps / 10000.0);
    END IF;
  END IF;

  v_platform_fee := v_platform_raw - v_vendor_cut;

  IF p_loyalty_rate_bps IS NOT NULL AND p_loyalty_rate_bps < v_platform_std_bps THEN
    v_loyalty_bonus := LEAST(
      GREATEST(ROUND(p_gross_cents * (v_platform_std_bps - p_loyalty_rate_bps) / 10000.0), 0),
      GREATEST(v_platform_fee, 0)
    );
    v_driver_net   := v_driver_net + v_loyalty_bonus;
    v_platform_fee := v_platform_fee - v_loyalty_bonus;
  END IF;

  v_discount_applied := LEAST(COALESCE(p_discount_cents,0), GREATEST(v_platform_fee,0));
  v_platform_fee := v_platform_fee - v_discount_applied;

  RETURN jsonb_build_object('driver_net',v_driver_net,'commander_cut',v_commander_cut,'vendor_cut',v_vendor_cut,
    'reserve',v_reserve,'platform_fee',v_platform_fee,'discount_applied',v_discount_applied,'loyalty_bonus',v_loyalty_bonus,
    'net_collected', p_gross_cents - v_discount_applied,
    'commander_id',v_commander_id,'commander_user_id',v_commander_user_id,'merchant_id',v_merchant_id,'node_id',v_node_id,
    'shop_recruiter_cut',v_shop_cut,'shop_recruiter_merchant_id',v_shop_id,'shop_recruiter_owner_id',v_shop_owner_id);
END;
$function$;

-- ── Record the shop's share (cash, wallet and card all call this) ────
CREATE OR REPLACE FUNCTION public.record_ride_kickbacks(p_ride_id uuid, p_rider_id uuid, p_gross_cents bigint, p_split jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF (p_split->>'commander_id') IS NOT NULL AND (p_split->>'commander_cut')::bigint > 0
     AND NOT EXISTS (SELECT 1 FROM public.commander_revshare_ledger WHERE ride_id = p_ride_id) THEN
    BEGIN
      INSERT INTO public.commander_revshare_ledger (commander_id, commander_user_id, ride_id, rider_id, fare_cents, revshare_cents, status)
      VALUES ((p_split->>'commander_id')::uuid, (p_split->>'commander_user_id')::uuid, p_ride_id, p_rider_id, p_gross_cents, (p_split->>'commander_cut')::bigint, 'pending');
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF (p_split->>'merchant_id') IS NOT NULL AND (p_split->>'vendor_cut')::bigint > 0
     AND NOT EXISTS (SELECT 1 FROM public.vendor_commissions WHERE ride_id = p_ride_id) THEN
    BEGIN
      INSERT INTO public.vendor_commissions (ride_id, kiosk_node_id, merchant_id, commission_rate, commission_cents, status)
      VALUES (p_ride_id, (p_split->>'node_id')::uuid, (p_split->>'merchant_id')::uuid,
              (p_split->>'vendor_cut')::numeric / NULLIF(p_gross_cents,0), (p_split->>'vendor_cut')::bigint, 'pending');
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF (p_split->>'shop_recruiter_merchant_id') IS NOT NULL AND COALESCE((p_split->>'shop_recruiter_cut')::bigint, 0) > 0 THEN
    BEGIN
      INSERT INTO public.shop_recruiter_revshare_ledger
        (merchant_id, merchant_owner_id, driver_id, ride_id, rider_id, fare_cents, revshare_cents, status)
      VALUES ((p_split->>'shop_recruiter_merchant_id')::uuid, (p_split->>'shop_recruiter_owner_id')::uuid,
              (SELECT driver_id FROM public.rides WHERE id = p_ride_id), p_ride_id, p_rider_id,
              p_gross_cents, (p_split->>'shop_recruiter_cut')::bigint, 'pending')
      ON CONFLICT (ride_id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
END;
$function$;

-- ── What a driver is shown on an offer ───────────────────────────────
CREATE OR REPLACE FUNCTION public.estimate_offer_driver_payout(p_gross_cents bigint, p_driver_id uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_driver_bps    int;
  v_commander_bps int;
  v_shop_bps      int;
  v_recruiter_uid uuid;
  v_recruiter_shop uuid;
  v_has_commander boolean := false;
  v_has_shop      boolean := false;
BEGIN
  IF p_gross_cents IS NULL OR p_gross_cents <= 0 THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(MAX(CASE WHEN key = 'DRIVER_SHARE_CENTS' THEN value_cents END), 8000),
         COALESCE(MAX(CASE WHEN key = 'COMMANDER_REVSHARE_RATE_CENTS' THEN value_cents END), 200),
         COALESCE(MAX(CASE WHEN key = 'SHOP_RECRUITER_RATE_CENTS' THEN value_cents END), 200)
    INTO v_driver_bps, v_commander_bps, v_shop_bps
    FROM public.pricing_config
   WHERE key IN ('DRIVER_SHARE_CENTS', 'COMMANDER_REVSHARE_RATE_CENTS', 'SHOP_RECRUITER_RATE_CENTS');

  SELECT recruited_by_commander_user_id, recruited_by_merchant_id INTO v_recruiter_uid, v_recruiter_shop
    FROM public.drivers WHERE id = p_driver_id;

  IF v_recruiter_uid IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.pod_commanders
                    WHERE user_id = v_recruiter_uid AND status = 'active')
      INTO v_has_commander;
  END IF;

  IF NOT v_has_commander AND v_recruiter_shop IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.merchants m
                    WHERE m.id = v_recruiter_shop AND COALESCE(m.is_active, false)
                      AND m.activation_status = 'active' AND m.created_by IS NOT NULL)
      INTO v_has_shop;
  END IF;

  RETURN ROUND(p_gross_cents * v_driver_bps / 10000.0)
       - CASE WHEN v_has_commander THEN ROUND(p_gross_cents * v_commander_bps / 10000.0) ELSE 0 END
       - CASE WHEN v_has_shop THEN ROUND(p_gross_cents * v_shop_bps / 10000.0) ELSE 0 END;
END;
$function$;

-- ── Driver links to the shop that onboarded them ─────────────────────
CREATE OR REPLACE FUNCTION public.driver_join_shop(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_driver record;
  v_shop record;
  v_done int;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please sign in again.');
  END IF;

  SELECT id, name, recruited_by_commander_user_id, recruited_by_merchant_id INTO v_driver
    FROM public.drivers WHERE user_id = auth.uid() FOR UPDATE;
  IF v_driver.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only registered drivers can use a shop code.');
  END IF;

  SELECT id, name, created_by INTO v_shop
    FROM public.merchants
   WHERE driver_invite_code = upper(trim(p_code))
     AND COALESCE(is_active, false) AND activation_status = 'active' AND created_by IS NOT NULL;
  IF v_shop.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'That shop code is not valid.');
  END IF;
  IF v_shop.created_by = auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'You can''t use your own shop''s code.');
  END IF;
  IF v_driver.recruited_by_merchant_id = v_shop.id THEN
    RETURN jsonb_build_object('success', true, 'shop_name', v_shop.name, 'already', true);
  END IF;
  IF v_driver.recruited_by_merchant_id IS NOT NULL OR v_driver.recruited_by_commander_user_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'You already drive under a shop or a G-Lead.');
  END IF;

  SELECT count(*) INTO v_done FROM public.rides WHERE driver_id = v_driver.id AND status = 'completed';
  IF v_done > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'A shop code can only be used before your first ride.');
  END IF;

  PERFORM set_config('gtaxi.network_move', 'on', true);
  UPDATE public.drivers SET recruited_by_merchant_id = v_shop.id, recruited_by_merchant_at = now() WHERE id = v_driver.id;
  PERFORM set_config('gtaxi.network_move', 'off', true);

  PERFORM public.notify_user(v_shop.created_by, 'grid', 'A driver joined through your shop',
      COALESCE(v_driver.name, 'A new driver') || ' signed up with your code. You earn 2% of their fares while your shop is active.');

  RETURN jsonb_build_object('success', true, 'shop_name', v_shop.name);
END;
$function$;

REVOKE ALL ON FUNCTION public.driver_join_shop(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_join_shop(text) TO authenticated;

-- ── Shop owner: their code and what their drivers have earned them ───
CREATE OR REPLACE FUNCTION public.merchant_driver_network()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shop record;
  v_code text;
  v_attempts int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please sign in again.');
  END IF;

  -- Owner only (not staff): the code moves money.
  SELECT id, name, driver_invite_code, COALESCE(is_active, false) AND activation_status = 'active' AS live
    INTO v_shop
    FROM public.merchants WHERE created_by = auth.uid()
   ORDER BY created_at ASC LIMIT 1;
  IF v_shop.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No shop found for this account.');
  END IF;

  v_code := v_shop.driver_invite_code;
  IF v_code IS NULL AND v_shop.live THEN
    LOOP
      v_code := 'S' || upper(substring(md5(v_shop.id::text || clock_timestamp()::text) from 1 for 6));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.merchants WHERE driver_invite_code = v_code);
      v_attempts := v_attempts + 1;
      IF v_attempts > 20 THEN RAISE EXCEPTION 'Could not generate unique code'; END IF;
    END LOOP;
    UPDATE public.merchants SET driver_invite_code = v_code WHERE id = v_shop.id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'merchant_id', v_shop.id,
    'active', v_shop.live,
    'code', CASE WHEN v_shop.live THEN v_code ELSE NULL END,
    'driver_count', (SELECT count(*) FROM public.drivers WHERE recruited_by_merchant_id = v_shop.id),
    'total_cents', (SELECT COALESCE(sum(revshare_cents), 0) FROM public.shop_recruiter_revshare_ledger
                     WHERE merchant_id = v_shop.id AND status IN ('pending', 'paid')),
    'pending_cents', (SELECT COALESCE(sum(revshare_cents), 0) FROM public.shop_recruiter_revshare_ledger
                       WHERE merchant_id = v_shop.id AND status = 'pending'),
    'ride_count', (SELECT count(*) FROM public.shop_recruiter_revshare_ledger
                    WHERE merchant_id = v_shop.id AND status IN ('pending', 'paid')));
END;
$function$;

REVOKE ALL ON FUNCTION public.merchant_driver_network() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_driver_network() TO authenticated;

-- ── G-Lead networks respect the one-recruiter rule ───────────────────
CREATE OR REPLACE FUNCTION public.request_network_join(p_commander_id uuid, p_message text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_driver RECORD; v_commander RECORD; v_req_id uuid;
BEGIN
    SELECT id, name, recruited_by_commander_user_id, recruited_at, recruited_by_merchant_id, recruited_by_merchant_at
      INTO v_driver FROM public.drivers WHERE user_id = auth.uid();
    IF v_driver.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Only registered drivers can join a network.'); END IF;
    SELECT id, user_id, status INTO v_commander FROM public.pod_commanders WHERE id = p_commander_id;
    IF v_commander.id IS NULL OR v_commander.status <> 'active' THEN RETURN jsonb_build_object('success', false, 'error', 'That network is not taking drivers right now.'); END IF;
    IF v_commander.user_id = auth.uid() THEN RETURN jsonb_build_object('success', false, 'error', 'You can''t join your own network.'); END IF;
    IF v_driver.recruited_by_commander_user_id = v_commander.user_id THEN RETURN jsonb_build_object('success', false, 'error', 'You''re already in this network.'); END IF;
    IF v_driver.recruited_by_commander_user_id IS NOT NULL AND v_driver.recruited_at IS NOT NULL AND v_driver.recruited_at > now() - interval '30 days' THEN
        RETURN jsonb_build_object('success', false, 'error', 'You can switch networks again on ' || to_char(v_driver.recruited_at + interval '30 days', 'FMDD Mon YYYY') || '.');
    END IF;
    IF v_driver.recruited_by_merchant_id IS NOT NULL AND v_driver.recruited_by_merchant_at IS NOT NULL
       AND v_driver.recruited_by_merchant_at > now() - interval '30 days' THEN
        RETURN jsonb_build_object('success', false, 'error', 'You can switch networks again on ' || to_char(v_driver.recruited_by_merchant_at + interval '30 days', 'FMDD Mon YYYY') || '.');
    END IF;
    UPDATE public.network_join_requests SET status = 'cancelled', decided_at = now() WHERE driver_id = v_driver.id AND status = 'pending';
    INSERT INTO public.network_join_requests (driver_id, driver_user_id, commander_id, commander_user_id, message)
    VALUES (v_driver.id, auth.uid(), v_commander.id, v_commander.user_id, NULLIF(trim(p_message), '')) RETURNING id INTO v_req_id;
    PERFORM public.notify_user(v_commander.user_id, 'grid', 'A driver wants to join your network',
        COALESCE(v_driver.name, 'A driver') || ' asked to drive under your name. Approve or decline in the app.');
    RETURN jsonb_build_object('success', true, 'request_id', v_req_id, 'network_name', public.network_display_name(v_commander.user_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.decide_network_join(p_request_id uuid, p_approve boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_req RECORD; v_driver RECORD; v_name text; v_shop_owner uuid;
BEGIN
    SELECT * INTO v_req FROM public.network_join_requests WHERE id = p_request_id FOR UPDATE;
    IF v_req.id IS NULL OR v_req.commander_user_id IS DISTINCT FROM auth.uid() THEN RETURN jsonb_build_object('success', false, 'error', 'Request not found.'); END IF;
    IF v_req.status <> 'pending' THEN RETURN jsonb_build_object('success', false, 'error', 'This request was already ' || v_req.status || '.'); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.pod_commanders WHERE id = v_req.commander_id AND status = 'active') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Your network is not active.'); END IF;
    v_name := public.network_display_name(v_req.commander_user_id);
    IF NOT p_approve THEN
        UPDATE public.network_join_requests SET status = 'declined', decided_at = now() WHERE id = v_req.id;
        PERFORM public.notify_user(v_req.driver_user_id, 'grid', v_name || ' isn''t taking you on right now', 'You can ask another network from the Networks screen.');
        RETURN jsonb_build_object('success', true, 'status', 'declined');
    END IF;
    SELECT id, name, recruited_by_commander_user_id, recruited_at, recruited_by_merchant_id, recruited_by_merchant_at
      INTO v_driver FROM public.drivers WHERE id = v_req.driver_id FOR UPDATE;
    IF v_driver.recruited_by_commander_user_id IS NOT NULL AND v_driver.recruited_by_commander_user_id <> v_req.commander_user_id
       AND v_driver.recruited_at IS NOT NULL AND v_driver.recruited_at > now() - interval '30 days' THEN
        UPDATE public.network_join_requests SET status = 'cancelled', decided_at = now() WHERE id = v_req.id;
        RETURN jsonb_build_object('success', false, 'error', 'This driver joined another network recently and can''t move yet.');
    END IF;
    IF v_driver.recruited_by_merchant_id IS NOT NULL AND v_driver.recruited_by_merchant_at IS NOT NULL
       AND v_driver.recruited_by_merchant_at > now() - interval '30 days' THEN
        UPDATE public.network_join_requests SET status = 'cancelled', decided_at = now() WHERE id = v_req.id;
        RETURN jsonb_build_object('success', false, 'error', 'This driver joined another network recently and can''t move yet.');
    END IF;
    IF v_driver.recruited_by_merchant_id IS NOT NULL THEN
        SELECT created_by INTO v_shop_owner FROM public.merchants WHERE id = v_driver.recruited_by_merchant_id;
    END IF;
    -- One recruiter: joining a G-Lead ends the shop link.
    PERFORM set_config('gtaxi.network_move', 'on', true);
    UPDATE public.drivers SET recruited_by_commander_user_id = v_req.commander_user_id, recruited_at = now(),
                              recruited_by_merchant_id = NULL, recruited_by_merchant_at = NULL
     WHERE id = v_driver.id;
    PERFORM set_config('gtaxi.network_move', 'off', true);
    UPDATE public.network_join_requests SET status = 'approved', decided_at = now() WHERE id = v_req.id;
    PERFORM public.notify_user(v_req.driver_user_id, 'grid', 'You''re in ' || v_name, 'You now drive under ' || v_name || '. Nothing changes in how you''re paid per ride.');
    IF v_driver.recruited_by_commander_user_id IS NOT NULL AND v_driver.recruited_by_commander_user_id <> v_req.commander_user_id THEN
        PERFORM public.notify_user(v_driver.recruited_by_commander_user_id, 'grid', 'A driver left your network',
            COALESCE(v_driver.name, 'A driver') || ' moved to another network. You stop earning on their rides from now on.');
    END IF;
    IF v_shop_owner IS NOT NULL THEN
        PERFORM public.notify_user(v_shop_owner, 'grid', 'A driver moved to a G-Lead network',
            COALESCE(v_driver.name, 'A driver') || ' now drives under a G-Lead. Your shop stops earning on their rides from now on.');
    END IF;
    RETURN jsonb_build_object('success', true, 'status', 'approved');
END;
$function$;
