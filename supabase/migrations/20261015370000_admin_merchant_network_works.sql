-- ═══════════════════════════════════════════════════════════════════
-- Admin Merchant Network page: see every merchant, manage subscriptions.
--
-- Before (verified live 2026-10-15):
--  - merchants had no admin read policy (only is_active or own), so the 5
--    pending+inactive merchants -- exactly the ones needing Activate /
--    Reject / Link owner -- were invisible.
--  - merchant_subscriptions has RLS on and ZERO policies: every merchant
--    showed "no subscription" though 12 rows exist.
--  - Trial / extend / pin fee / status / active-toggle wrote these tables
--    from the browser, which the SELECT-only grants refuse.
--  - "Run billing now" called process_merchant_billing, which authenticated
--    cannot execute.
--  - Merchant detail reads orders and nfc_event_logs: no admin read policy.
--
-- After: admin (role = 'admin') read policies on merchants,
-- merchant_subscriptions, orders, nfc_event_logs; admin-guarded functions
-- for the writes; no grants widened for anyone else.
-- ═══════════════════════════════════════════════════════════════════

-- SECURITY DEFINER so policies can ask "is the caller an admin?" without
-- needing (or recursing through) profiles RLS.
CREATE OR REPLACE FUNCTION public.auth_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'::user_role);
$function$;
REVOKE ALL ON FUNCTION public.auth_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_is_admin() TO authenticated;

DROP POLICY IF EXISTS "Admins read all merchants" ON public.merchants;
CREATE POLICY "Admins read all merchants" ON public.merchants
  FOR SELECT TO authenticated USING (public.auth_is_admin());

DROP POLICY IF EXISTS "Admins read merchant subscriptions" ON public.merchant_subscriptions;
CREATE POLICY "Admins read merchant subscriptions" ON public.merchant_subscriptions
  FOR SELECT TO authenticated USING (public.auth_is_admin());

DROP POLICY IF EXISTS "Admins read all orders" ON public.orders;
CREATE POLICY "Admins read all orders" ON public.orders
  FOR SELECT TO authenticated USING (public.auth_is_admin());

DROP POLICY IF EXISTS "Admins read nfc event logs" ON public.nfc_event_logs;
CREATE POLICY "Admins read nfc event logs" ON public.nfc_event_logs
  FOR SELECT TO authenticated USING (public.auth_is_admin());

-- Subscription edits (status / trial end / pin fee), admin only.
CREATE OR REPLACE FUNCTION public.admin_update_merchant_subscription(
  p_sub_id uuid,
  p_status text DEFAULT NULL,
  p_trial_end_at timestamptz DEFAULT NULL,
  p_pin_fee_cents integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_row public.merchant_subscriptions;
BEGIN
  IF NOT public.auth_is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('trial', 'active', 'overdue', 'suspended', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid status %', p_status;
  END IF;

  UPDATE public.merchant_subscriptions
     SET status          = COALESCE(p_status, status),
         trial_end_at    = COALESCE(p_trial_end_at, trial_end_at),
         pin_fee_cents   = COALESCE(p_pin_fee_cents, pin_fee_cents),
         -- reactivating starts a fresh 30-day cycle and clears overdue
         next_billing_at = CASE WHEN p_status = 'active' THEN now() + interval '30 days' ELSE next_billing_at END,
         overdue_since   = CASE WHEN p_status IN ('active', 'trial') THEN NULL ELSE overdue_since END
   WHERE id = p_sub_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Subscription not found');
  END IF;
  RETURN jsonb_build_object('success', true, 'status', v_row.status);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_update_merchant_subscription(uuid, text, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_merchant_subscription(uuid, text, timestamptz, integer) TO authenticated;

-- Merchant on/off switch, admin only.
CREATE OR REPLACE FUNCTION public.admin_set_merchant_active(p_merchant_id uuid, p_active boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NOT public.auth_is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;
  UPDATE public.merchants SET is_active = p_active WHERE id = p_merchant_id;
  RETURN jsonb_build_object('success', FOUND);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_set_merchant_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_merchant_active(uuid, boolean) TO authenticated;

-- "Run billing now", admin only (process_merchant_billing itself stays
-- non-executable by app users; it still honours the master switch).
CREATE OR REPLACE FUNCTION public.admin_run_merchant_billing()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NOT public.auth_is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;
  RETURN public.process_merchant_billing();
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_run_merchant_billing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_run_merchant_billing() TO authenticated;
