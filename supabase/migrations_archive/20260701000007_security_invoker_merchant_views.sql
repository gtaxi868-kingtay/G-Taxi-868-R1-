-- Fix 3 SECURITY DEFINER views (advisor ERROR security_definer_view).
-- Without security_invoker, a view runs with its owner's rights and BYPASSES
-- RLS on the underlying tables — so any authenticated user could read every
-- merchant's data through merchant_orders / merchant_wallet_balance / merchant_nodes.
--
-- security_invoker=true makes each view respect the querying user's RLS.
-- Safe: orders already has policy "Merchants can view their business orders"
-- (merchant_id IN their profile's merchant_id) and merchants has a public
-- "view active merchants" policy. merchant_nodes / merchant_wallet_balance have
-- no code consumers. Verified at apply time: 0 orders + 0 profiles.merchant_id,
-- so no observable behavior change today; closes the leak going forward.
--
-- NOTE (pre-existing, out of scope): the merchant RLS keys on
-- profiles.merchant_id which is never populated, so the merchant app won't see
-- orders until that linkage is wired. Tracked separately.

ALTER VIEW public.merchant_nodes          SET (security_invoker = true);
ALTER VIEW public.merchant_wallet_balance SET (security_invoker = true);
ALTER VIEW public.merchant_orders         SET (security_invoker = true);
