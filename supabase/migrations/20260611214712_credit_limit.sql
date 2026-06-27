ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS credit_limit_cents INTEGER NOT NULL DEFAULT 60000;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS credit_used_cents INTEGER NOT NULL DEFAULT 0;

-- Migrate existing negative wallet balances into credit_used
UPDATE public.drivers d
SET credit_used_cents = ABS(wt.balance)
FROM (
    SELECT user_id, SUM(amount) as balance
    FROM public.wallet_transactions
    WHERE amount < 0 AND transaction_type IN ('commission_fee', 'lease_deduction', 'debt_recovery')
    GROUP BY user_id
) wt
WHERE d.user_id = wt.user_id AND wt.balance < 0;

-- Ensure new drivers get $600 TTD credit limit
ALTER TABLE public.drivers ALTER COLUMN credit_limit_cents SET DEFAULT 60000;
