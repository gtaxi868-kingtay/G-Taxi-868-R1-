-- ═══════════════════════════════════════════════════════════════════════════
-- MAKE THE SWITCHES REAL — server-side half
-- (2026-08-08)
--
-- One helper every SQL-side feature gate uses. Boring on purpose: a single
-- lookup with one defined default, so no caller has to remember which way to
-- fail when a flag row is missing.
--
-- Missing row => TRUE. A feature that predates its switch keeps working, and
-- an accidentally deleted flag row can never silently withhold money someone
-- has already earned. Only an explicit `false` turns something off.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.feature_enabled(p_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT COALESCE((SELECT is_active FROM public.system_feature_flags WHERE id = p_id), true);
$$;

REVOKE ALL ON FUNCTION public.feature_enabled(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feature_enabled(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.feature_enabled(text) IS
'Single source for SQL-side feature gates. Missing flag row means enabled — never withhold behaviour (or money) because a row vanished.';

-- merchant_commission_enabled was one of nine switches that controlled
-- nothing. It is the only one that moves MONEY, so it is gated in the
-- database rather than in the edge function that calls it:
--   * complete_ride cannot currently be redeployed — the project is at its
--     edge-function cap and every deploy returns 402;
--   * a money gate at one call site could be bypassed by any other caller.
-- Gating inside the function covers every caller and needs no deploy.
CREATE OR REPLACE FUNCTION public.credit_merchant_commission(p_merchant_id uuid, p_ride_id uuid, p_amount_cents integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_user_id UUID;
BEGIN
    IF NOT public.feature_enabled('merchant_commission_enabled') THEN
        RETURN;
    END IF;
    SELECT created_by INTO v_user_id FROM merchants WHERE id = p_merchant_id;
    IF v_user_id IS NULL THEN RETURN; END IF;
    INSERT INTO wallet_transactions (user_id, ride_id, amount, transaction_type, description, status)
    VALUES (v_user_id, p_ride_id, p_amount_cents, 'merchant_commission', 'Vendor kiosk commission', 'completed');
END;
$function$;

-- Verified live in a rolled-back transaction against a real merchant row:
--   switch ON  -> commission paid          0 -> 1   PASS
--   switch OFF -> commission blocked       1 -> 1   PASS
--   flag row deleted -> still pays         1 -> 2   PASS (fail safe)
