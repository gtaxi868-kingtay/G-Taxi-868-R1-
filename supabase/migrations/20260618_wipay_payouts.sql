-- 20260618_wipay_payouts.sql
-- WiPay disbursement/payout tracking for driver cash-out.
-- When admin approves a payout request (payout_requests), the wallet is debited.
-- This table tracks the ACTUAL bank transfer via WiPay's disbursement API.
--
-- Flow:
--   1. Driver requests payout → payout_requests (pending)
--   2. Admin approves → process_payout_request RPC debits wallet (processing)
--   3. admin_process_payout calls wipay_disburse edge function
--   4. wipay_disburse POSTs to WiPay /v1/gateway/payout → records here
--   5. WiPay sends webhook → wipay_webhook updates status (completed/failed)
--
-- Supports cash-out to T&T bank accounts via WiPay's settlement network.
-- Designed for extension to other Caribbean markets (WiPay operates in
-- multiple CARICOM states).

CREATE TABLE IF NOT EXISTS public.wipay_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to the internal payout request
  payout_request_id UUID NOT NULL REFERENCES public.payout_requests(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,

  -- Payout details
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'TTD',
  bank_name TEXT NOT NULL,
  account_holder TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_type TEXT DEFAULT 'savings',

  -- WiPay reference
  wipay_transaction_id TEXT,          -- returned by WiPay on successful submission
  wipay_reference TEXT,               -- our idempotency key / orderId sent to WiPay
  idempotency_key TEXT UNIQUE,        -- prevents duplicate disbursements

  -- Status machine
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',       -- created, not yet sent to WiPay
      'submitted',     -- sent to WiPay, awaiting webhook
      'completed',     -- confirmed delivered by WiPay webhook
      'failed'         -- WiPay rejected or webhook reported failure
    )),

  -- Raw API response for debugging
  raw_response JSONB,

  -- Timestamps
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for admin lookup
CREATE INDEX idx_wipay_payouts_status ON public.wipay_payouts(status);
CREATE INDEX idx_wipay_payouts_driver ON public.wipay_payouts(driver_id);
CREATE INDEX idx_wipay_payouts_request ON public.wipay_payouts(payout_request_id);

-- RLS: service_role only (internal edge function)
ALTER TABLE public.wipay_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wipay_payouts_service_only"
  ON public.wipay_payouts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_wipay_payouts_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wipay_payouts_updated_at ON public.wipay_payouts;
CREATE TRIGGER trg_wipay_payouts_updated_at
  BEFORE UPDATE ON public.wipay_payouts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_wipay_payouts_timestamp();
