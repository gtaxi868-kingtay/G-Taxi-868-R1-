-- Merchant payout accounts — collected at merchant onboarding (the invite
-- claim flow), so the platform can pay merchants out. Mirrors wipay_payouts'
-- column naming for consistency; separate table (not a merchants column)
-- because banking details are sensitive and should carry their own RLS.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.merchant_payout_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id    uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  bank_name      text,
  account_holder text,
  account_number text,
  account_type   text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_merchant_payout_accounts_merchant ON public.merchant_payout_accounts (merchant_id);

ALTER TABLE public.merchant_payout_accounts ENABLE ROW LEVEL SECURITY;

-- Merchant owner (merchants.created_by) can see/manage their own payout account.
CREATE POLICY merchant_payout_self ON public.merchant_payout_accounts
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = merchant_id AND m.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = merchant_id AND m.created_by = auth.uid()));

-- Admin can see/manage all (needed to actually run payouts).
CREATE POLICY merchant_payout_admin_all ON public.merchant_payout_accounts
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
