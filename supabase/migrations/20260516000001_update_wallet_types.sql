-- UPDATE WALLET TRANSACTION TYPES
-- For Phase 1: Ledger Integrity

ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_transaction_type_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_transaction_type_check 
    CHECK (transaction_type IN ('topup', 'ride_payment', 'refund', 'bonus', 'driver_payout', 'commission_fee', 'payout', 'debt_repayment'));

COMMENT ON TABLE public.wallet_transactions IS 'Financial ledger for all user and driver funds. Truth is Sum(amount).';
