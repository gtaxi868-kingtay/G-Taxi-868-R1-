-- Businesses claim the record that already exists, and hotels set their own
-- room rates.
--
-- WHY (founder, 2026-10-26): "I don't want our team stuck checking their
-- site." Until now a hotel had no way in: lodging_nodes rows were typed in by
-- admin (owner rate quote via EscapeManagement), 0 of 3 hotels were linked to
-- a merchant, and merchant_invites could only be minted by a commander
-- registering a NEW kiosk node, so an existing business could never take
-- over its own record.
--
-- WHAT:
--  1. merchant_invites can now point at an EXISTING merchant (claims_existing),
--     with no node or commander. merchant_signup attaches the new owner to
--     that record instead of creating a second one.
--  2. admin_create_business_claim(): admin mints a claim link for a merchant,
--     or for a hotel (creating its merchant record on the fly).
--  3. merchant_my_lodging() / merchant_set_lodging_rate(): the hotel reads and
--     sets its own nightly rate. It writes the SAME quote fields admin used,
--     so propose_escape_packages() (daily) picks it up with no other change.

-- 1 ---------------------------------------------------------------------------
ALTER TABLE public.merchant_invites ALTER COLUMN kiosk_node_id DROP NOT NULL;
ALTER TABLE public.merchant_invites ALTER COLUMN commander_id DROP NOT NULL;
ALTER TABLE public.merchant_invites ADD COLUMN IF NOT EXISTS claims_existing boolean NOT NULL DEFAULT false;
ALTER TABLE public.merchant_invites ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_create_business_claim(
    p_merchant_id uuid DEFAULT NULL,
    p_lodging_id uuid DEFAULT NULL,
    p_days integer DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_merchant public.merchants%ROWTYPE;
    v_lodging public.lodging_nodes%ROWTYPE;
    v_node uuid;
    v_token uuid;
BEGIN
    IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND role = 'admin') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Admins only.');
    END IF;
    IF (p_merchant_id IS NULL) = (p_lodging_id IS NULL) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Pass a business or a hotel, not both.');
    END IF;
    IF p_days IS NULL OR p_days < 1 OR p_days > 90 THEN
        RETURN jsonb_build_object('success', false, 'error', 'A claim link lasts 1 to 90 days.');
    END IF;

    IF p_lodging_id IS NOT NULL THEN
        SELECT * INTO v_lodging FROM public.lodging_nodes WHERE id = p_lodging_id FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'Hotel not found.');
        END IF;
        IF v_lodging.merchant_id IS NULL THEN
            -- A hotel typed in by admin has no business record yet: make one.
            INSERT INTO public.merchants (name, category, lat, lng, activation_status, is_active)
            VALUES (v_lodging.name, 'hotel', v_lodging.lat, v_lodging.lng, 'pending', false)
            RETURNING id INTO p_merchant_id;
            UPDATE public.lodging_nodes SET merchant_id = p_merchant_id, updated_at = now() WHERE id = p_lodging_id;
        ELSE
            p_merchant_id := v_lodging.merchant_id;
        END IF;
    END IF;

    SELECT * INTO v_merchant FROM public.merchants WHERE id = p_merchant_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Business not found.');
    END IF;
    IF v_merchant.created_by IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.profiles WHERE merchant_id = p_merchant_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'This business already has an owner account.');
    END IF;

    -- Only the newest link works.
    UPDATE public.merchant_invites SET status = 'expired'
     WHERE merchant_id = p_merchant_id AND claims_existing AND status = 'pending';

    SELECT id INTO v_node FROM public.kiosk_nodes WHERE merchant_id = p_merchant_id ORDER BY created_at LIMIT 1;

    INSERT INTO public.merchant_invites (kiosk_node_id, commander_id, merchant_name, merchant_id, claims_existing, created_by, expires_at)
    VALUES (v_node, NULL, v_merchant.name, p_merchant_id, true, v_uid, now() + make_interval(days => p_days))
    RETURNING token INTO v_token;

    RETURN jsonb_build_object(
        'success', true,
        'merchant_id', p_merchant_id,
        'business_name', v_merchant.name,
        'invite_token', v_token,
        -- Same public onboarding page the commander invites use.
        'claim_url', 'https://g-taxi-868-r1-admin.vercel.app/merchant-onboard?invite=' || v_token::text,
        'expires_at', now() + make_interval(days => p_days)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_business_claim(uuid, uuid, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_business_claim(uuid, uuid, integer) TO authenticated;

-- 3 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merchant_my_lodging()
RETURNS TABLE (
    id uuid, name text, destination_code text, location_zone text,
    min_guests integer, max_guests integer, nights integer, is_active boolean,
    quoted_rate_per_night_cents integer, quoted_at timestamptz, quote_expires_at timestamptz,
    rate_set_by_hotel boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT l.id, l.name, l.destination_code, l.location_zone,
           l.min_guests, l.max_guests, l.nights, l.is_active,
           l.quoted_rate_per_night_cents, l.quoted_at, l.quote_expires_at,
           (l.quoted_by IS NOT NULL AND l.quoted_by = auth.uid()) AS rate_set_by_hotel
      FROM public.lodging_nodes l
      JOIN public.profiles p ON p.id = auth.uid() AND p.merchant_id = l.merchant_id
     ORDER BY l.name;
$$;

REVOKE ALL ON FUNCTION public.merchant_my_lodging() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.merchant_my_lodging() TO authenticated;

CREATE OR REPLACE FUNCTION public.merchant_set_lodging_rate(
    p_lodging_id uuid,
    p_rate_cents integer,
    p_valid_days integer DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_expires timestamptz;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Please sign in again.');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.lodging_nodes l
          JOIN public.profiles p ON p.id = v_uid AND p.merchant_id = l.merchant_id
         WHERE l.id = p_lodging_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'This property is not on your account.');
    END IF;
    -- TT$50 to TT$100,000 a night: catches a missing or extra zero.
    IF p_rate_cents IS NULL OR p_rate_cents < 5000 OR p_rate_cents > 10000000 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter a nightly rate between TT$50 and TT$100,000.');
    END IF;
    -- At least 7 days: G only builds packages on rates good for 3+ more days.
    IF p_valid_days IS NULL OR p_valid_days < 7 OR p_valid_days > 180 THEN
        RETURN jsonb_build_object('success', false, 'error', 'A rate must be good for 7 to 180 days.');
    END IF;

    v_expires := now() + make_interval(days => p_valid_days);
    UPDATE public.lodging_nodes
       SET quoted_rate_per_night_cents = p_rate_cents,
           quoted_at = now(),
           quoted_by = v_uid,
           quote_expires_at = v_expires,
           quote_contact_note = 'Set by the hotel in the G868 business app',
           updated_at = now()
     WHERE id = p_lodging_id;

    RETURN jsonb_build_object('success', true, 'rate_cents', p_rate_cents, 'expires_at', v_expires);
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_set_lodging_rate(uuid, integer, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.merchant_set_lodging_rate(uuid, integer, integer) TO authenticated;
