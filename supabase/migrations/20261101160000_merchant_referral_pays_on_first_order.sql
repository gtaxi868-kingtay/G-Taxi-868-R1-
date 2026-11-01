-- A merchant referral now pays when an approved business has its first real
-- order delivered, not at sign-up, which let any signed-in caller collect TT$15
-- on each side. Fires from the orders table because several paths mark an order
-- delivered. An order placed by the owner or the referrer does not count.
-- Referrals already paid stay paid. apply_referral_code keeps its signature, so
-- its grants stay.

CREATE OR REPLACE FUNCTION public.apply_referral_code(p_referee_id uuid, p_code text, p_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_referrer_id UUID;
    v_credit INTEGER := 1500;
BEGIN
    IF auth.uid() IS NOT NULL AND p_referee_id IS DISTINCT FROM auth.uid() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
    END IF;

    SELECT user_id INTO v_referrer_id FROM referral_codes WHERE code = upper(p_code) AND type = p_type;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code'); END IF;
    IF v_referrer_id = p_referee_id THEN RETURN jsonb_build_object('success', false, 'error', 'Cannot use own code'); END IF;
    IF EXISTS (SELECT 1 FROM referral_earnings WHERE referee_id = p_referee_id AND type = p_type) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Referral already used');
    END IF;

    IF p_type = 'rider' THEN
        -- Recorded now, paid by pay_rider_referral_on_first_ride.
        INSERT INTO referral_earnings (referrer_id, referee_id, type, amount_cents, status, expires_at)
        VALUES (v_referrer_id, p_referee_id, p_type, v_credit, 'pending', now() + interval '90 days');

        UPDATE profiles SET referred_by_rider_id = v_referrer_id WHERE id = p_referee_id AND referred_by_rider_id IS NULL;
        UPDATE referral_codes SET uses = uses + 1 WHERE code = upper(p_code);

        RETURN jsonb_build_object('success', true, 'referrer_id', v_referrer_id, 'credit_cents', v_credit,
                                  'pays_on', 'first_completed_ride');
    END IF;

    IF p_type IN ('driver', 'merchant') THEN
        -- Recorded now. A driver is paid by increment_driver_referral_reward once
        -- approved with DRIVER_REFERRAL_TARGET_RIDES finished; a merchant by
        -- pay_merchant_referral_on_delivery on its first real delivered order.
        INSERT INTO referral_earnings (referrer_id, referee_id, type, amount_cents, status)
        VALUES (v_referrer_id, p_referee_id, p_type, v_credit, 'pending');

        UPDATE referral_codes SET uses = uses + 1 WHERE code = upper(p_code);

        RETURN jsonb_build_object('success', true, 'referrer_id', v_referrer_id, 'credit_cents', v_credit,
                                  'pays_on', CASE p_type WHEN 'driver' THEN 'approved_driver_rides' ELSE 'first_delivered_order' END);
    END IF;

    RETURN jsonb_build_object('success', false, 'error', 'Unknown referral type');
END;
$function$;

CREATE OR REPLACE FUNCTION public.pay_merchant_referral_on_delivery()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_owner uuid;
    v_ref   record;
BEGIN
    SELECT created_by INTO v_owner FROM public.merchants
     WHERE id = NEW.merchant_id AND activation_status = 'active' AND is_active = true;
    IF v_owner IS NULL OR NEW.total_cents <= 0 OR NEW.rider_id = v_owner THEN
        RETURN NEW;
    END IF;

    SELECT id, referrer_id, amount_cents INTO v_ref
      FROM public.referral_earnings
     WHERE referee_id = v_owner AND type = 'merchant' AND status = 'pending'
     ORDER BY created_at ASC
     LIMIT 1
     FOR UPDATE;
    IF v_ref.id IS NULL OR NEW.rider_id = v_ref.referrer_id THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.wallet_transactions (user_id, amount, transaction_type, description, reference_id, status)
    VALUES
        (v_ref.referrer_id, v_ref.amount_cents, 'bonus', 'Referral bonus — your business delivered its first order',
         'referral:' || v_ref.id::text, 'completed'),
        (v_owner, v_ref.amount_cents, 'bonus', 'Welcome bonus — first delivered order with a referral code',
         'referral:' || v_ref.id::text, 'completed');

    UPDATE public.referral_earnings SET status = 'paid' WHERE id = v_ref.id;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- A referral problem must never stop an order being delivered.
    RAISE WARNING 'pay_merchant_referral_on_delivery failed for order %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.pay_merchant_referral_on_delivery() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pay_merchant_referral ON public.orders;
CREATE TRIGGER trg_pay_merchant_referral
    AFTER UPDATE ON public.orders
    FOR EACH ROW
    WHEN (NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered')
    EXECUTE FUNCTION public.pay_merchant_referral_on_delivery();
