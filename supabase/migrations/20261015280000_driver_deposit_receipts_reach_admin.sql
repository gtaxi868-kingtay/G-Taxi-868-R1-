-- ═══════════════════════════════════════════════════════════════════
-- Driver deposit receipts reach the admin review queue, once.
--
-- Before (verified live 2026-10-15):
--  - "Upload Bank Receipt" inserted into manual_deposits, but authenticated
--    had SELECT only, and the insert named a reference_token column that
--    does not exist. Every upload failed after the photo was sent.
--  - "Smart ATM Deposit" went to settlement_requests via submit_settlement,
--    a queue no admin screen reads (admin Financials reads manual_deposits).
--  - Nothing stopped the same bank/ATM transaction reference being
--    submitted twice.
--
-- After:
--  - manual_deposits.reference_token (text) with a unique index, so one
--    bank/ATM reference can only ever be claimed once.
--  - Drivers may INSERT only (user_id, amount_cents, receipt_url,
--    reference_token): status defaults to 'pending' and only admin's
--    verify_deposit can approve (the wallet credit trigger fires on
--    pending -> approved only).
--  - The insert policy also requires the receipt to be in the caller's
--    own folder of the private receipts bucket.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.manual_deposits
  ADD COLUMN IF NOT EXISTS reference_token text;

CREATE UNIQUE INDEX IF NOT EXISTS manual_deposits_reference_token_key
  ON public.manual_deposits (reference_token)
  WHERE reference_token IS NOT NULL;

DROP POLICY IF EXISTS "Users insert own deposits" ON public.manual_deposits;
CREATE POLICY "Users insert own deposits"
  ON public.manual_deposits
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND status = 'pending'
    AND split_part(receipt_url, '/', 1) = (SELECT auth.uid())::text
  );

GRANT INSERT (user_id, amount_cents, receipt_url, reference_token) ON public.manual_deposits TO authenticated;
