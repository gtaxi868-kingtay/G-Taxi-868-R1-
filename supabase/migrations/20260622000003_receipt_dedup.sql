-- ════════════════════════════════════════════════════════════════════════
-- RECEIPT DEDUP — prevent the same bank/ATM transaction being credited twice
-- ════════════════════════════════════════════════════════════════════════
-- parse_receipt OCRs a `reference_token` (the bank/ATM transaction id), but
-- manual_deposits had nowhere to store or dedup on it — so re-uploading the
-- same receipt could be approved + credited twice. We store the token and
-- enforce uniqueness at the database level (the UI pre-check is convenience;
-- this is the real guard, race-proof under concurrent uploads).

ALTER TABLE public.manual_deposits
  ADD COLUMN IF NOT EXISTS reference_token text;

-- Multiple NULLs allowed (receipts where OCR found no reference still go to
-- manual review); any non-null transaction id can exist at most once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_deposits_reference
  ON public.manual_deposits (reference_token)
  WHERE reference_token IS NOT NULL;

-- Same guard for the Smart-ATM settlement path (submit_settlement already
-- stores reference_token into settlement_requests; this enforces uniqueness).
CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_requests_reference
  ON public.settlement_requests (reference_token)
  WHERE reference_token IS NOT NULL;
