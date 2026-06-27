-- ADD IDEMPOTENCY KEY TO RIDES
-- For Phase 4: Financial Ledger & Transactional Integrity

ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rides_idempotency ON public.rides(rider_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.rides.idempotency_key IS 'Client-generated UUID to prevent duplicate ride requests during network retries.';
