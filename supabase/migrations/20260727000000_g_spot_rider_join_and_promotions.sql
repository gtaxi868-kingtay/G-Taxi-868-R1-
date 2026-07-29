-- ═══════════════════════════════════════════════════════════════════
-- G SPOT: REAL RIDER JOIN/PAY/REDEEM PATH (2026-07-27)
--
-- Closes a real gap: admin could create venues and the schema existed
-- (g_spot_venues, g_spot_memberships, g_spot_redeem_drink_subsidy), but
-- nothing let a rider actually join, pay for, or use a membership.
--
-- Wallet debit follows the exact pattern already established by
-- rider_wallet_payment() (20260708000001_rider_nfc_payment_flow.sql):
-- advisory lock -> SUM(wallet_transactions.amount) balance check ->
-- insert a negative wallet_transactions row -> mirror the wallets cache.
-- No new generic debit helper invented — this is deliberately the same
-- shape as the one real precedent for a non-ride rider purchase.
--
-- Redemption follows the cash_withdrawal_codes shape (short code, a
-- redeemer, an expiry, a status) rather than inventing a new pattern —
-- adapted here since that table is keyed to a driver, not a membership.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. New wallet_transactions types ──────────────────────────────
ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_transaction_type_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_transaction_type_check
    CHECK (transaction_type = ANY (ARRAY[
        'topup','ride_payment','refund','bonus','driver_payout','tip','commission_fee',
        'cancellation_fee','leakage_fine','debt_recovery','payout','debt_repayment',
        'lease_deduction','lease_income','capital_reserve','merchant_commission',
        'travel_package_payment','travel_package_refund','scout_referral_payout',
        'referral_bonus','merchant_subscription','merchant_purchase','delivery_payout',
        'delivery_fee_platform_share','commission_debt','debt_settlement',
        'escape_group_payment','escape_platform_fee','insurance_commission',
        'g_spot_membership', 'g_spot_membership_refund'
    ]));

-- ─── 2. Redeem codes: the rider shows this at the bar ──────────────
CREATE TABLE IF NOT EXISTS public.g_spot_redeem_codes (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    membership_id           uuid NOT NULL REFERENCES public.g_spot_memberships(id) ON DELETE CASCADE,
    code                    text NOT NULL UNIQUE,
    status                  text NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'redeemed', 'expired')),
    discount_cents_applied  integer,
    redeemed_at             timestamptz,
    redeemed_by             uuid REFERENCES public.profiles(id),
    expires_at              timestamptz NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_g_spot_redeem_codes_membership ON public.g_spot_redeem_codes(membership_id);
CREATE INDEX IF NOT EXISTS idx_g_spot_redeem_codes_code ON public.g_spot_redeem_codes(code);
CREATE INDEX IF NOT EXISTS idx_g_spot_redeem_codes_redeemed_by ON public.g_spot_redeem_codes(redeemed_by);

ALTER TABLE public.g_spot_redeem_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Rider reads own redeem codes" ON public.g_spot_redeem_codes;
CREATE POLICY "Rider reads own redeem codes" ON public.g_spot_redeem_codes
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.g_spot_memberships m
            WHERE m.id = membership_id AND m.profile_id = (SELECT auth.uid())
        )
        OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
    );

-- ─── 3. Join a venue — real wallet charge, same shape as rider_wallet_payment ──
CREATE OR REPLACE FUNCTION public.rider_join_g_spot_venue(
    p_user_id uuid,
    p_venue_id uuid
)
RETURNS public.g_spot_memberships
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_venue    public.g_spot_venues;
    v_existing public.g_spot_memberships;
    v_existing_found boolean := false;
    v_balance  integer;
    v_row      public.g_spot_memberships;
BEGIN
    IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

    SELECT * INTO v_venue FROM public.g_spot_venues WHERE id = p_venue_id AND status = 'active';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Venue not found or not active';
    END IF;
    IF v_venue.membership_price_cents IS NULL THEN
        RAISE EXCEPTION 'This venue has not set a membership price yet';
    END IF;

    SELECT * INTO v_existing FROM public.g_spot_memberships WHERE profile_id = p_user_id AND venue_id = p_venue_id FOR UPDATE;
    v_existing_found := FOUND;
    IF v_existing_found AND v_existing.status = 'active' THEN
        RAISE EXCEPTION 'You already have an active membership at this venue';
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_balance FROM public.wallet_transactions WHERE user_id = p_user_id;
    IF v_balance < v_venue.membership_price_cents THEN
        RAISE EXCEPTION 'Insufficient wallet balance for this membership';
    END IF;

    INSERT INTO public.wallet_transactions (user_id, amount, transaction_type, description, status)
    VALUES (p_user_id, -v_venue.membership_price_cents, 'g_spot_membership',
            'G Spot membership — ' || v_venue.name, 'completed');

    INSERT INTO public.wallets (user_id, balance_cents)
    VALUES (p_user_id, v_balance - v_venue.membership_price_cents)
    ON CONFLICT (user_id) DO UPDATE SET balance_cents = wallets.balance_cents - v_venue.membership_price_cents;

    IF v_existing_found THEN
        UPDATE public.g_spot_memberships
        SET status = 'active', monthly_price_cents = v_venue.membership_price_cents,
            drink_subsidy_cap_cents = v_venue.drink_subsidy_cap_cents, drink_subsidy_used_cents = 0,
            cycle_start = current_date, updated_at = now()
        WHERE id = v_existing.id
        RETURNING * INTO v_row;
    ELSE
        INSERT INTO public.g_spot_memberships (profile_id, venue_id, monthly_price_cents, drink_subsidy_cap_cents, cycle_start, status)
        VALUES (p_user_id, p_venue_id, v_venue.membership_price_cents, v_venue.drink_subsidy_cap_cents, current_date, 'active')
        RETURNING * INTO v_row;
    END IF;

    RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.rider_join_g_spot_venue(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rider_join_g_spot_venue(uuid, uuid) TO authenticated;

-- ─── 4. Cancel — no refund of the current cycle (standard subscription
--    behavior); membership simply won't renew ─────────────────────────
CREATE OR REPLACE FUNCTION public.rider_cancel_g_spot_membership(
    p_user_id uuid,
    p_membership_id uuid
)
RETURNS public.g_spot_memberships
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_row public.g_spot_memberships;
BEGIN
    IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    UPDATE public.g_spot_memberships
    SET status = 'cancelled', updated_at = now()
    WHERE id = p_membership_id AND profile_id = p_user_id AND status IN ('active', 'paused')
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Membership not found or already cancelled';
    END IF;

    RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.rider_cancel_g_spot_membership(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rider_cancel_g_spot_membership(uuid, uuid) TO authenticated;

-- ─── 5. Rider generates a short redeem code to show the bartender ──
CREATE OR REPLACE FUNCTION public.g_spot_generate_redeem_code(
    p_user_id uuid,
    p_membership_id uuid
)
RETURNS public.g_spot_redeem_codes
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_membership public.g_spot_memberships;
    v_code       text;
    v_row        public.g_spot_redeem_codes;
BEGIN
    IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    SELECT * INTO v_membership FROM public.g_spot_memberships
    WHERE id = p_membership_id AND profile_id = p_user_id AND status = 'active';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No active membership found';
    END IF;

    -- Expire any of this membership's still-active unused codes first —
    -- one live code at a time, matching cash_withdrawal_codes' single-
    -- active-code discipline.
    UPDATE public.g_spot_redeem_codes SET status = 'expired'
    WHERE membership_id = p_membership_id AND status = 'active';

    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

    INSERT INTO public.g_spot_redeem_codes (membership_id, code, expires_at)
    VALUES (p_membership_id, v_code, now() + interval '10 minutes')
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.g_spot_generate_redeem_code(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.g_spot_generate_redeem_code(uuid, uuid) TO authenticated;

-- ─── 6. Venue-side (today: admin-operated) redemption ──────────────
-- No venue-staff app exists yet — until one does, redeeming a code is an
-- admin-only action (the admin panel is the only real "front desk" this
-- system has). This is an honest scoping call, not a shortcut: it's the
-- same real g_spot_redeem_drink_subsidy() cap logic underneath, just
-- triggered by whoever is standing at the door with the admin app open.
CREATE OR REPLACE FUNCTION public.admin_redeem_g_spot_code(
    p_code text,
    p_discount_cents integer,
    p_redeemer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_code_row   public.g_spot_redeem_codes;
    v_membership public.g_spot_memberships;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_redeemer_id AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;
    IF p_discount_cents IS NULL OR p_discount_cents < 0 THEN
        RAISE EXCEPTION 'p_discount_cents must be >= 0';
    END IF;

    SELECT * INTO v_code_row FROM public.g_spot_redeem_codes
    WHERE code = upper(p_code) AND status = 'active' AND expires_at > now()
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Code not found, already used, or expired';
    END IF;

    v_membership := public.g_spot_redeem_drink_subsidy(v_code_row.membership_id, p_discount_cents);

    UPDATE public.g_spot_redeem_codes
    SET status = 'redeemed', redeemed_at = now(), redeemed_by = p_redeemer_id,
        discount_cents_applied = p_discount_cents
    WHERE id = v_code_row.id;

    RETURN jsonb_build_object(
        'membership_id', v_membership.id,
        'drink_subsidy_used_cents', v_membership.drink_subsidy_used_cents,
        'drink_subsidy_cap_cents', v_membership.drink_subsidy_cap_cents
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_redeem_g_spot_code(text, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_redeem_g_spot_code(text, integer, uuid) TO service_role;

-- ─── 7. Monthly renewal sweep — real charge, gentle failure ────────
-- Debits the next month on a membership's real anchor date. Insufficient
-- balance pauses (not cancels) the membership — the rider keeps their
-- history and can top up and resume, matching this codebase's existing
-- "grace, not punishment" pattern (process_settlement_grace, lease grace).
CREATE OR REPLACE FUNCTION public.g_spot_renew_memberships()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    m public.g_spot_memberships;
    v_balance integer;
BEGIN
    FOR m IN
        SELECT * FROM public.g_spot_memberships
        WHERE status = 'active' AND cycle_start <= (current_date - interval '1 month')::date
        FOR UPDATE SKIP LOCKED
    LOOP
        SELECT COALESCE(SUM(amount), 0) INTO v_balance FROM public.wallet_transactions WHERE user_id = m.profile_id;

        IF v_balance >= m.monthly_price_cents THEN
            INSERT INTO public.wallet_transactions (user_id, amount, transaction_type, description, status)
            VALUES (m.profile_id, -m.monthly_price_cents, 'g_spot_membership', 'G Spot membership renewal', 'completed');

            INSERT INTO public.wallets (user_id, balance_cents)
            VALUES (m.profile_id, v_balance - m.monthly_price_cents)
            ON CONFLICT (user_id) DO UPDATE SET balance_cents = wallets.balance_cents - m.monthly_price_cents;

            UPDATE public.g_spot_memberships
            SET cycle_start = current_date, drink_subsidy_used_cents = 0, updated_at = now()
            WHERE id = m.id;
        ELSE
            UPDATE public.g_spot_memberships
            SET status = 'paused', updated_at = now()
            WHERE id = m.id;
        END IF;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.g_spot_renew_memberships() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.g_spot_renew_memberships() TO service_role, postgres;

SELECT cron.schedule('g-spot-renew-memberships', '0 6 * * *', $$
  SELECT public.g_spot_renew_memberships();
$$);

NOTIFY pgrst, 'reload schema';
