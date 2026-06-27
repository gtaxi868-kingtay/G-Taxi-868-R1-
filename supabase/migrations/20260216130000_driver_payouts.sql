-- MIGRATION: 20260216130000_driver_payouts.sql
-- IMPLEMENTS: 80/20 Platform Split & Driver Payout logic

-- 1. Ensure System/Platform Profile exists
INSERT INTO auth.users (id, email) 
VALUES ('00000000-0000-0000-0000-000000000000', 'system@gtaxi868.com')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, email, full_name, is_admin)
VALUES ('00000000-0000-0000-0000-000000000000', 'system@gtaxi868.com', 'G-Taxi Platform', true)
ON CONFLICT DO NOTHING;
-- 2. Update process_wallet_payment to handle the 80/20 split
CREATE OR REPLACE FUNCTION public.process_wallet_payment(
    p_ride_id UUID,
    p_amount INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
    v_rider_id UUID;
    v_driver_id UUID;
    v_platform_id UUID := '00000000-0000-0000-0000-000000000000';
    v_driver_net INTEGER;
    v_platform_fee INTEGER;
    v_current_balance INTEGER;
BEGIN
    -- 1. Get Ride Details
    SELECT rider_id, driver_id INTO v_rider_id, v_driver_id 
    FROM public.rides WHERE id = p_ride_id;

    IF v_rider_id IS NULL OR v_driver_id IS NULL THEN
        RAISE EXCEPTION 'Ride not found or driver not assigned';
    END IF;

    -- 2. Check Rider Balance (Safety Double Check)
    SELECT COALESCE(SUM(amount), 0) INTO v_current_balance 
    FROM public.wallet_transactions WHERE user_id = v_rider_id;

    IF v_current_balance < p_amount THEN
        RETURN FALSE;
    END IF;

    -- 3. Calculate Split (80/20)
    v_platform_fee := ROUND(p_amount * 0.20);
    v_driver_net := p_amount - v_platform_fee;

    -- 4. Transactions (Atomic)
    -- A. Debit Rider (Total)
    INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
    VALUES (v_rider_id, p_ride_id, -p_amount, 'debit', 'Ride payment');

    -- B. Credit Driver (80%)
    INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
    VALUES (v_driver_id, p_ride_id, v_driver_net, 'credit', 'Ride earnings (80%)');

    -- C. Credit Platform (20%)
    INSERT INTO public.wallet_transactions (user_id, ride_id, amount, type, description)
    VALUES (v_platform_id, p_ride_id, v_platform_fee, 'credit', 'Platform commission (20%)');

    -- 5. Update Ride Status
    UPDATE public.rides 
    SET payment_status = 'captured',
        updated_at = NOW()
    WHERE id = p_ride_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
