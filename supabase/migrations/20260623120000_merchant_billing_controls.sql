-- Merchant billing controls — correct the pin/listing fee into a proper
-- admin-controlled MONTHLY subscription (90-day free trial per merchant).
--
-- Background: the live system already bills merchants monthly via
-- process_merchant_billing() (daily cron 'merchant-daily-billing'), with a
-- 90-day trial auto-applied to every new merchant by trg_auto_merchant_subscription.
-- A second, BROKEN cron 'charge-merchant-pin-fees' ran every 15 min and called an
-- edge function that was never deployed (404 every 15 min, collected nothing).
--
-- This migration:
--   1. Adds an admin-editable global monthly fee (pricing_config).
--   2. Adds a master network on/off switch (system_feature_flags), default OFF
--      so NO merchant is charged until an admin deliberately enables billing.
--   3. Adds a per-merchant on/off override (merchant_subscriptions.billing_enabled)
--      that also controls the map pin (merchants.is_pinned).
--   4. Rewrites process_merchant_billing() to honour the global fee + both switches.
--   5. Adds admin RPCs (callable from admin web + mobile) for the per-merchant
--      toggle and a billing overview (also used by the AI watcher).
--   6. Removes the broken 15-minute 'charge-merchant-pin-fees' cron.
-- Money logic stays 100% in deterministic SQL; the AI only observes (later step).

-- 1) Admin-editable global monthly fee (TTD cents). Default TTD $150.00.
INSERT INTO public.pricing_config (key, value_cents, description)
VALUES ('MERCHANT_MONTHLY_FEE_CENTS', 15000,
        'Merchant network listing/pin fee — billed monthly after a 90-day free trial (TTD cents). Admin-editable.')
ON CONFLICT (key) DO NOTHING;

-- 2) Master network switch — DEFAULT OFF (safe: nobody billed until admin turns it on).
INSERT INTO public.system_feature_flags (id, is_active, description, applies_to)
VALUES ('merchant_billing_enabled', false,
        'Master switch for the merchant monthly billing program. Off = no merchant is charged.',
        'all')
ON CONFLICT (id) DO NOTHING;

-- 3) Per-merchant override (also gates the map pin).
ALTER TABLE public.merchant_subscriptions
  ADD COLUMN IF NOT EXISTS billing_enabled boolean NOT NULL DEFAULT true;

-- 4) Rewrite the monthly billing function: honour global fee + master + per-merchant switches.
CREATE OR REPLACE FUNCTION public.process_merchant_billing()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    rec          RECORD;
    v_balance    INTEGER;
    v_fee        INTEGER;
    v_total_fee  INTEGER;
    v_master_on  BOOLEAN;
    v_charged    INTEGER := 0;
    v_overdue    INTEGER := 0;
    v_activated  INTEGER := 0;
BEGIN
    -- Master switch gate
    SELECT is_active INTO v_master_on
    FROM public.system_feature_flags
    WHERE id = 'merchant_billing_enabled';

    IF NOT COALESCE(v_master_on, false) THEN
        RETURN jsonb_build_object('skipped', 'master_switch_off', 'run_at', now());
    END IF;

    -- Global, admin-editable fee
    SELECT value_cents INTO v_fee
    FROM public.pricing_config
    WHERE key = 'MERCHANT_MONTHLY_FEE_CENTS';
    v_fee := COALESCE(v_fee, 15000);

    -- End-of-trial activation (billing-enabled merchants only)
    UPDATE public.merchant_subscriptions
    SET status = 'active',
        next_billing_at = now() + INTERVAL '30 days'
    WHERE status = 'trial'
      AND trial_end_at <= now()
      AND billing_enabled = true;
    GET DIAGNOSTICS v_activated = ROW_COUNT;

    -- Monthly charge for due, active, billing-enabled merchants
    FOR rec IN
        SELECT ms.id, ms.merchant_id, ms.pin_fee_cents, m.created_by
        FROM public.merchant_subscriptions ms
        JOIN public.merchants m ON m.id = ms.merchant_id
        WHERE ms.status = 'active'
          AND ms.next_billing_at <= now()
          AND ms.billing_enabled = true
    LOOP
        SELECT COALESCE(balance_cents, 0) INTO v_balance
        FROM public.wallets WHERE user_id = rec.created_by;

        v_total_fee := v_fee + COALESCE(rec.pin_fee_cents, 0);

        IF v_balance >= v_total_fee THEN
            UPDATE public.wallets
            SET balance_cents = balance_cents - v_total_fee
            WHERE user_id = rec.created_by;

            INSERT INTO public.wallet_transactions (user_id, amount, transaction_type, description, status)
            VALUES (rec.created_by, -v_total_fee, 'merchant_subscription',
                    'G-Taxi merchant listing — monthly fee', 'completed');

            UPDATE public.merchant_subscriptions
            SET last_billed_at = now(),
                next_billing_at = now() + INTERVAL '30 days',
                overdue_since = NULL
            WHERE id = rec.id;

            v_charged := v_charged + 1;
        ELSE
            UPDATE public.merchant_subscriptions
            SET status = 'overdue',
                overdue_since = COALESCE(overdue_since, now())
            WHERE id = rec.id;

            v_overdue := v_overdue + 1;
        END IF;
    END LOOP;

    -- Suspend merchants overdue more than 7 days
    UPDATE public.merchant_subscriptions
    SET status = 'suspended'
    WHERE status = 'overdue'
      AND overdue_since <= now() - INTERVAL '7 days';

    RETURN jsonb_build_object(
        'activated', v_activated,
        'charged',   v_charged,
        'overdue',   v_overdue,
        'fee_cents', v_fee,
        'run_at',    now()
    );
END;
$function$;

-- 5a) Admin RPC — per-merchant on/off override (billing + map pin together).
CREATE OR REPLACE FUNCTION public.admin_set_merchant_billing(p_merchant_id uuid, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized: admin role required';
    END IF;

    UPDATE public.merchant_subscriptions
    SET billing_enabled = p_enabled
    WHERE merchant_id = p_merchant_id;

    UPDATE public.merchants
    SET is_pinned = p_enabled
    WHERE id = p_merchant_id;
END;
$function$;

-- 5b) Admin RPC — billing overview for the dashboard (web + mobile) and AI watcher.
CREATE OR REPLACE FUNCTION public.admin_get_merchant_billing_overview()
RETURNS TABLE(
    merchant_id        uuid,
    merchant_name      text,
    status             text,
    billing_enabled    boolean,
    is_pinned          boolean,
    trial_end_at       timestamptz,
    next_billing_at    timestamptz,
    last_billed_at     timestamptz,
    monthly_fee_cents  integer,
    wallet_balance_cents integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_fee INTEGER;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized: admin role required';
    END IF;

    SELECT value_cents INTO v_fee FROM public.pricing_config WHERE key = 'MERCHANT_MONTHLY_FEE_CENTS';
    v_fee := COALESCE(v_fee, 15000);

    RETURN QUERY
    SELECT m.id,
           m.name,
           ms.status,
           ms.billing_enabled,
           m.is_pinned,
           ms.trial_end_at,
           ms.next_billing_at,
           ms.last_billed_at,
           v_fee + COALESCE(ms.pin_fee_cents, 0),
           COALESCE(w.balance_cents, 0)
    FROM public.merchants m
    LEFT JOIN public.merchant_subscriptions ms ON ms.merchant_id = m.id
    LEFT JOIN public.wallets w ON w.user_id = m.created_by
    ORDER BY ms.status, m.name;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_set_merchant_billing(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_merchant_billing_overview() TO authenticated;

-- 6) Remove the broken 15-minute pin-fee cron (idempotent).
DO $cron$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'charge-merchant-pin-fees') THEN
        DO $cronguard$ BEGIN
          IF current_setting('cron.database_name', true) IS NOT DISTINCT FROM current_database() THEN
            IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'charge-merchant-pin-fees') THEN PERFORM cron.unschedule('charge-merchant-pin-fees'); END IF;
          ELSE
            RAISE NOTICE 'pg_cron not operational in % — skipping cron op', current_database();
          END IF;
        END $cronguard$;
    END IF;
END
$cron$;
