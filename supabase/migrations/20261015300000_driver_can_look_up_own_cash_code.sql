-- ═══════════════════════════════════════════════════════════════════
-- Driver "Redeem Cash Code": the lookup step can find the code.
--
-- Before (verified live 2026-10-15): the screen looked the code up by
-- reading cash_withdrawal_codes directly, but RLS only lets the RIDER who
-- created a code read it, so the driver always got "Code not found" and
-- never reached the (working) redeem_cash_code function.
--
-- After: lookup_cash_withdrawal_code(code) returns amount/status/expiry
-- only when the caller is the driver the code was issued to; anyone else
-- gets "not found" (no probing other people's codes). No table access is
-- widened; redemption itself is unchanged.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.lookup_cash_withdrawal_code(p_code text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
              'found', true,
              'amount_cents', c.amount_cents,
              'status', c.status,
              'expires_at', c.expires_at)
       FROM public.cash_withdrawal_codes c
       JOIN public.drivers d ON d.id = c.driver_id
      WHERE c.code = upper(p_code)
        AND d.user_id = auth.uid()
      LIMIT 1),
    jsonb_build_object('found', false)
  );
$function$;

REVOKE ALL ON FUNCTION public.lookup_cash_withdrawal_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_cash_withdrawal_code(text) TO authenticated;
