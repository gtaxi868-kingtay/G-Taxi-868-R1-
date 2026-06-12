CREATE TABLE IF NOT EXISTS public.bank_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL UNIQUE REFERENCES public.drivers(id) ON DELETE CASCADE,
    account_holder_name TEXT NOT NULL,
    bank_name TEXT NOT NULL,
    account_type TEXT NOT NULL DEFAULT 'savings' CHECK (account_type IN ('savings', 'chequing', 'business')),
    account_number TEXT NOT NULL,
    routing_number TEXT,
    branch_code TEXT,
    is_verified BOOLEAN NOT NULL DEFAULT false,
    is_default BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers can manage their own bank accounts"
    ON public.bank_accounts FOR ALL
    USING (driver_id = (SELECT id FROM public.drivers WHERE user_id = auth.uid()))
    WITH CHECK (driver_id = (SELECT id FROM public.drivers WHERE user_id = auth.uid()));

CREATE POLICY "Admins can view all bank accounts"
    ON public.bank_accounts FOR SELECT
    USING (auth.uid() IN (SELECT id FROM public.profiles WHERE is_admin = true));
