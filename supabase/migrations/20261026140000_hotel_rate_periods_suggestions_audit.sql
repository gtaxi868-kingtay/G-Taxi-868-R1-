-- Hotel rates done properly: date ranges that can never overlap, an audit
-- trail for every claim and rate change, revocable claim links, and rate
-- SUGGESTIONS (from the hotel's own website, later Booking.com) that only go
-- live when the hotel accepts them.
--
-- Founder, 2026-10-26: "claim links expire and are single-use; the admin can
-- regenerate or revoke one; every claim and rate change is audit-logged;
-- overlapping rate date-ranges are rejected; the package builder provably
-- reads only active rates."
--
-- How the package builder stays honest: propose_escape_packages() reads
-- lodging_nodes.quoted_rate_per_night_cents / quote_expires_at. Those fields
-- are now DERIVED from the active period covering today (Trinidad date) by
-- refresh_lodging_quote(), which runs on every rate change and daily at
-- 06:00 Trinidad time. A cancelled or ended period clears the quote, so G
-- can never build a package on it. Quotes admin typed by hand before this
-- (no period rows) are left alone until the hotel sets its own.

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- Periods --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lodging_rate_periods (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lodging_id  uuid NOT NULL REFERENCES public.lodging_nodes(id) ON DELETE CASCADE,
    rate_cents  integer NOT NULL CHECK (rate_cents BETWEEN 5000 AND 10000000),
    valid_from  date NOT NULL,
    valid_to    date NOT NULL,          -- inclusive
    status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
    source      text NOT NULL CHECK (source IN ('hotel', 'admin', 'website', 'booking_com')),
    created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    cancelled_at timestamptz,
    CONSTRAINT lodging_rate_periods_dates CHECK (valid_to >= valid_from AND valid_to <= valid_from + 366),
    CONSTRAINT lodging_rate_periods_no_overlap EXCLUDE USING gist (
        lodging_id WITH =,
        daterange(valid_from, valid_to, '[]') WITH &&
    ) WHERE (status = 'active')
);
CREATE INDEX IF NOT EXISTS lodging_rate_periods_lodging_idx ON public.lodging_rate_periods (lodging_id, valid_from);

-- Suggestions (never live until accepted) -------------------------------------
CREATE TABLE IF NOT EXISTS public.lodging_rate_suggestions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lodging_id  uuid NOT NULL REFERENCES public.lodging_nodes(id) ON DELETE CASCADE,
    source      text NOT NULL CHECK (source IN ('website', 'booking_com')),
    source_url  text,
    rate_cents  integer CHECK (rate_cents IS NULL OR rate_cents > 0),
    currency    text,                   -- 'TTD', 'USD' or NULL when unclear
    amount_text text,                   -- exactly as found, e.g. "US$185"
    excerpt     text,                   -- the words around it, for the hotel to check
    status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'superseded')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    decided_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    decided_at  timestamptz
);
CREATE INDEX IF NOT EXISTS lodging_rate_suggestions_pending_idx ON public.lodging_rate_suggestions (lodging_id) WHERE status = 'pending';

ALTER TABLE public.lodging_nodes ADD COLUMN IF NOT EXISTS rate_source_url text;
ALTER TABLE public.lodging_nodes ADD COLUMN IF NOT EXISTS booking_hotel_id text;

-- Audit ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_audit_log (
    id          bigserial PRIMARY KEY,
    merchant_id uuid REFERENCES public.merchants(id) ON DELETE SET NULL,
    lodging_id  uuid REFERENCES public.lodging_nodes(id) ON DELETE SET NULL,
    actor       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    action      text NOT NULL,
    detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_audit_log_merchant_idx ON public.business_audit_log (merchant_id, created_at DESC);

-- Writes only through the functions below; admin can read everything.
ALTER TABLE public.lodging_rate_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lodging_rate_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lodging_rate_periods, public.lodging_rate_suggestions, public.business_audit_log FROM anon, authenticated;
GRANT SELECT ON public.lodging_rate_periods, public.lodging_rate_suggestions, public.business_audit_log TO authenticated;
DROP POLICY IF EXISTS "Admin reads rate periods" ON public.lodging_rate_periods;
CREATE POLICY "Admin reads rate periods" ON public.lodging_rate_periods FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin'));
DROP POLICY IF EXISTS "Admin reads rate suggestions" ON public.lodging_rate_suggestions;
CREATE POLICY "Admin reads rate suggestions" ON public.lodging_rate_suggestions FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin'));
DROP POLICY IF EXISTS "Admin reads business audit" ON public.business_audit_log;
CREATE POLICY "Admin reads business audit" ON public.business_audit_log FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin'));

-- Helpers ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tt_today() RETURNS date
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$ SELECT (now() AT TIME ZONE 'America/Port_of_Spain')::date $$;

-- The caller's own property, or NULL. Owner = profile linked to the hotel's
-- business record.
CREATE OR REPLACE FUNCTION public._owned_lodging(p_lodging_id uuid) RETURNS public.lodging_nodes
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
    SELECT l.* FROM public.lodging_nodes l
      JOIN public.profiles p ON p.id = auth.uid() AND p.merchant_id = l.merchant_id
     WHERE l.id = p_lodging_id
$$;
REVOKE ALL ON FUNCTION public._owned_lodging(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_lodging_quote(p_lodging_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
    v_p public.lodging_rate_periods%ROWTYPE;
    v_has_periods boolean;
BEGIN
    SELECT EXISTS (SELECT 1 FROM public.lodging_rate_periods WHERE lodging_id = p_lodging_id) INTO v_has_periods;
    IF NOT v_has_periods THEN RETURN; END IF;   -- an old hand-typed admin quote stays as it was

    SELECT * INTO v_p FROM public.lodging_rate_periods
     WHERE lodging_id = p_lodging_id AND status = 'active'
       AND public.tt_today() BETWEEN valid_from AND valid_to
     LIMIT 1;

    IF FOUND THEN
        UPDATE public.lodging_nodes SET
            quoted_rate_per_night_cents = v_p.rate_cents,
            quoted_at = v_p.created_at,
            quoted_by = v_p.created_by,
            -- valid through the end of valid_to, Trinidad time
            quote_expires_at = ((v_p.valid_to + 1)::timestamp AT TIME ZONE 'America/Port_of_Spain'),
            quote_contact_note = 'Rate period (' || v_p.source || ') ' || v_p.id::text,
            updated_at = now()
         WHERE id = p_lodging_id;
    ELSE
        UPDATE public.lodging_nodes SET
            quoted_rate_per_night_cents = NULL, quoted_at = NULL, quoted_by = NULL,
            quote_expires_at = NULL, quote_contact_note = 'No active rate today',
            updated_at = now()
         WHERE id = p_lodging_id;
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_lodging_quote(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_all_lodging_quotes() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE r record; n integer := 0;
BEGIN
    FOR r IN SELECT DISTINCT lodging_id FROM public.lodging_rate_periods LOOP
        PERFORM public.refresh_lodging_quote(r.lodging_id);
        n := n + 1;
    END LOOP;
    RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_all_lodging_quotes() FROM public, anon, authenticated;

-- Core: add one active period, rejecting overlaps in plain words.
CREATE OR REPLACE FUNCTION public._add_rate_period(
    p_lodging_id uuid, p_rate_cents integer, p_from date, p_to date, p_source text, p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
    v_id uuid;
    v_clash public.lodging_rate_periods%ROWTYPE;
    v_merchant uuid;
BEGIN
    IF p_rate_cents IS NULL OR p_rate_cents < 5000 OR p_rate_cents > 10000000 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter a nightly rate between TT$50 and TT$100,000.');
    END IF;
    IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
        RETURN jsonb_build_object('success', false, 'error', 'The end date must be on or after the start date.');
    END IF;
    IF p_from < public.tt_today() THEN
        RETURN jsonb_build_object('success', false, 'error', 'A rate cannot start in the past.');
    END IF;
    IF p_to > p_from + 366 THEN
        RETURN jsonb_build_object('success', false, 'error', 'A rate can cover at most one year.');
    END IF;

    SELECT * INTO v_clash FROM public.lodging_rate_periods
     WHERE lodging_id = p_lodging_id AND status = 'active'
       AND daterange(valid_from, valid_to, '[]') && daterange(p_from, p_to, '[]')
     ORDER BY valid_from LIMIT 1;
    IF FOUND THEN
        RETURN jsonb_build_object('success', false, 'error',
            format('These dates overlap your rate of TT$%s for %s to %s. Cancel that rate first, or pick other dates.',
                   to_char(v_clash.rate_cents / 100.0, 'FM999,990.00'),
                   to_char(v_clash.valid_from, 'DD Mon YYYY'), to_char(v_clash.valid_to, 'DD Mon YYYY')),
            'clash_period_id', v_clash.id);
    END IF;

    BEGIN
        INSERT INTO public.lodging_rate_periods (lodging_id, rate_cents, valid_from, valid_to, source, created_by)
        VALUES (p_lodging_id, p_rate_cents, p_from, p_to, p_source, p_actor)
        RETURNING id INTO v_id;
    EXCEPTION WHEN exclusion_violation THEN
        -- Two saves at the same moment: the constraint is the real guard.
        RETURN jsonb_build_object('success', false, 'error', 'These dates overlap another rate. Refresh and try again.');
    END;

    SELECT merchant_id INTO v_merchant FROM public.lodging_nodes WHERE id = p_lodging_id;
    INSERT INTO public.business_audit_log (merchant_id, lodging_id, actor, action, detail)
    VALUES (v_merchant, p_lodging_id, p_actor, 'rate_added',
            jsonb_build_object('period_id', v_id, 'rate_cents', p_rate_cents, 'from', p_from, 'to', p_to, 'source', p_source));
    PERFORM public.refresh_lodging_quote(p_lodging_id);
    RETURN jsonb_build_object('success', true, 'period_id', v_id, 'rate_cents', p_rate_cents, 'from', p_from, 'to', p_to);
END;
$$;
REVOKE ALL ON FUNCTION public._add_rate_period(uuid, integer, date, date, text, uuid) FROM public, anon, authenticated;

-- Owner API ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merchant_add_lodging_rate(
    p_lodging_id uuid, p_rate_cents integer, p_from date, p_to date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in again.'); END IF;
    IF (public._owned_lodging(p_lodging_id)).id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'This property is not on your account.');
    END IF;
    RETURN public._add_rate_period(p_lodging_id, p_rate_cents, p_from, p_to, 'hotel', auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.merchant_add_lodging_rate(uuid, integer, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.merchant_add_lodging_rate(uuid, integer, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.merchant_cancel_lodging_rate(p_period_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE v_p public.lodging_rate_periods%ROWTYPE; v_merchant uuid;
BEGIN
    IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in again.'); END IF;
    SELECT * INTO v_p FROM public.lodging_rate_periods WHERE id = p_period_id FOR UPDATE;
    IF NOT FOUND OR (public._owned_lodging(v_p.lodging_id)).id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'This rate is not on your account.');
    END IF;
    IF v_p.status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'This rate is already cancelled.');
    END IF;
    UPDATE public.lodging_rate_periods SET status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now() WHERE id = p_period_id;
    SELECT merchant_id INTO v_merchant FROM public.lodging_nodes WHERE id = v_p.lodging_id;
    INSERT INTO public.business_audit_log (merchant_id, lodging_id, actor, action, detail)
    VALUES (v_merchant, v_p.lodging_id, auth.uid(), 'rate_cancelled',
            jsonb_build_object('period_id', v_p.id, 'rate_cents', v_p.rate_cents, 'from', v_p.valid_from, 'to', v_p.valid_to));
    PERFORM public.refresh_lodging_quote(v_p.lodging_id);
    RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.merchant_cancel_lodging_rate(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.merchant_cancel_lodging_rate(uuid) TO authenticated;

-- "Change my rate from today": ends the rate covering today (yesterday, or
-- cancels it if it only started today), then adds the new one. A FUTURE rate
-- inside the new dates is never overwritten: that is rejected as an overlap.
CREATE OR REPLACE FUNCTION public.merchant_set_lodging_rate(
    p_lodging_id uuid, p_rate_cents integer, p_valid_days integer DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
    v_today date := public.tt_today();
    v_cur public.lodging_rate_periods%ROWTYPE;
    v_future public.lodging_rate_periods%ROWTYPE;
    v_res jsonb;
BEGIN
    IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in again.'); END IF;
    IF (public._owned_lodging(p_lodging_id)).id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'This property is not on your account.');
    END IF;
    IF p_valid_days IS NULL OR p_valid_days < 7 OR p_valid_days > 180 THEN
        RETURN jsonb_build_object('success', false, 'error', 'A rate must be good for 7 to 180 days.');
    END IF;
    IF p_rate_cents IS NULL OR p_rate_cents < 5000 OR p_rate_cents > 10000000 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter a nightly rate between TT$50 and TT$100,000.');
    END IF;

    SELECT * INTO v_cur FROM public.lodging_rate_periods
     WHERE lodging_id = p_lodging_id AND status = 'active' AND v_today BETWEEN valid_from AND valid_to
     FOR UPDATE;
    IF FOUND THEN
        -- Check the new range against FUTURE periods before touching today's.
        SELECT * INTO v_future FROM public.lodging_rate_periods
         WHERE lodging_id = p_lodging_id AND status = 'active' AND id <> v_cur.id
           AND daterange(valid_from, valid_to, '[]') && daterange(v_today, v_today + p_valid_days - 1, '[]')
         ORDER BY valid_from LIMIT 1;
        IF FOUND THEN
            RETURN jsonb_build_object('success', false, 'error',
                format('You already have a rate of TT$%s from %s to %s. Choose fewer days, or cancel that rate first. Today''s rate was not changed.',
                       to_char(v_future.rate_cents / 100.0, 'FM999,990.00'),
                       to_char(v_future.valid_from, 'DD Mon YYYY'), to_char(v_future.valid_to, 'DD Mon YYYY')),
                'clash_period_id', v_future.id);
        END IF;
        IF v_cur.valid_from = v_today THEN
            UPDATE public.lodging_rate_periods SET status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now() WHERE id = v_cur.id;
        ELSE
            UPDATE public.lodging_rate_periods SET valid_to = v_today - 1 WHERE id = v_cur.id;
        END IF;
        INSERT INTO public.business_audit_log (merchant_id, lodging_id, actor, action, detail)
        SELECT merchant_id, p_lodging_id, auth.uid(), 'rate_replaced',
               jsonb_build_object('period_id', v_cur.id, 'old_rate_cents', v_cur.rate_cents)
          FROM public.lodging_nodes WHERE id = p_lodging_id;
    END IF;

    v_res := public._add_rate_period(p_lodging_id, p_rate_cents, v_today, v_today + p_valid_days - 1, 'hotel', auth.uid());
    RETURN v_res || jsonb_build_object('expires_at', ((v_today + p_valid_days)::timestamp AT TIME ZONE 'America/Port_of_Spain'));
END;
$$;
REVOKE ALL ON FUNCTION public.merchant_set_lodging_rate(uuid, integer, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.merchant_set_lodging_rate(uuid, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.merchant_set_rate_source(p_lodging_id uuid, p_url text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE v_l public.lodging_nodes%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in again.'); END IF;
    v_l := public._owned_lodging(p_lodging_id);
    IF v_l.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'This property is not on your account.'); END IF;
    IF p_url IS NOT NULL AND (length(p_url) > 500 OR p_url !~* '^https?://[a-z0-9.-]+\.[a-z]{2,}(:443|:80)?(/|$|\?)') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Paste the full web address of your rates page, starting with https://');
    END IF;
    UPDATE public.lodging_nodes SET rate_source_url = NULLIF(trim(p_url), ''), updated_at = now() WHERE id = p_lodging_id;
    INSERT INTO public.business_audit_log (merchant_id, lodging_id, actor, action, detail)
    VALUES (v_l.merchant_id, p_lodging_id, auth.uid(), 'rate_source_set', jsonb_build_object('url', p_url));
    RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.merchant_set_rate_source(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.merchant_set_rate_source(uuid, text) TO authenticated;

-- Accept (with the dates and, if needed, a corrected TT$ amount) or reject.
CREATE OR REPLACE FUNCTION public.merchant_decide_rate_suggestion(
    p_suggestion_id uuid, p_accept boolean, p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_rate_cents integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
    v_s public.lodging_rate_suggestions%ROWTYPE;
    v_l public.lodging_nodes%ROWTYPE;
    v_res jsonb;
    v_rate integer;
BEGIN
    IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in again.'); END IF;
    SELECT * INTO v_s FROM public.lodging_rate_suggestions WHERE id = p_suggestion_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Suggestion not found.'); END IF;
    v_l := public._owned_lodging(v_s.lodging_id);
    IF v_l.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'This property is not on your account.'); END IF;
    IF v_s.status <> 'pending' THEN RETURN jsonb_build_object('success', false, 'error', 'This suggestion was already handled.'); END IF;

    IF NOT p_accept THEN
        UPDATE public.lodging_rate_suggestions SET status = 'rejected', decided_by = auth.uid(), decided_at = now() WHERE id = v_s.id;
        INSERT INTO public.business_audit_log (merchant_id, lodging_id, actor, action, detail)
        VALUES (v_l.merchant_id, v_l.id, auth.uid(), 'suggestion_rejected', jsonb_build_object('suggestion_id', v_s.id, 'source', v_s.source));
        RETURN jsonb_build_object('success', true);
    END IF;

    -- A foreign-currency amount is never converted for the hotel: they type the TT$ rate.
    v_rate := COALESCE(p_rate_cents, CASE WHEN v_s.currency = 'TTD' THEN v_s.rate_cents END);
    IF v_rate IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter the nightly rate in TT dollars to accept this.');
    END IF;
    v_res := public._add_rate_period(v_l.id, v_rate, COALESCE(p_from, public.tt_today()), COALESCE(p_to, public.tt_today() + 29), v_s.source, auth.uid());
    IF (v_res->>'success')::boolean THEN
        UPDATE public.lodging_rate_suggestions SET status = 'accepted', decided_by = auth.uid(), decided_at = now() WHERE id = v_s.id;
        INSERT INTO public.business_audit_log (merchant_id, lodging_id, actor, action, detail)
        VALUES (v_l.merchant_id, v_l.id, auth.uid(), 'suggestion_accepted',
                jsonb_build_object('suggestion_id', v_s.id, 'source', v_s.source, 'rate_cents', v_rate, 'period_id', v_res->>'period_id'));
    END IF;
    RETURN v_res;
END;
$$;
REVOKE ALL ON FUNCTION public.merchant_decide_rate_suggestion(uuid, boolean, date, date, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.merchant_decide_rate_suggestion(uuid, boolean, date, date, integer) TO authenticated;

-- The owner's view now carries periods, the pending suggestion and the
-- rates-page link (return type changed, so drop first).
DROP FUNCTION IF EXISTS public.merchant_my_lodging();
CREATE FUNCTION public.merchant_my_lodging()
RETURNS TABLE (
    id uuid, name text, destination_code text, location_zone text,
    min_guests integer, max_guests integer, nights integer, is_active boolean,
    quoted_rate_per_night_cents integer, quoted_at timestamptz, quote_expires_at timestamptz,
    rate_set_by_hotel boolean, rate_source_url text, periods jsonb, pending_suggestion jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
    SELECT l.id, l.name, l.destination_code, l.location_zone,
           l.min_guests, l.max_guests, l.nights, l.is_active,
           l.quoted_rate_per_night_cents, l.quoted_at, l.quote_expires_at,
           (l.quoted_by IS NOT NULL AND l.quoted_by = auth.uid()) AS rate_set_by_hotel,
           l.rate_source_url,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('id', rp.id, 'rate_cents', rp.rate_cents, 'from', rp.valid_from,
                                                         'to', rp.valid_to, 'source', rp.source) ORDER BY rp.valid_from)
                       FROM public.lodging_rate_periods rp
                      WHERE rp.lodging_id = l.id AND rp.status = 'active' AND rp.valid_to >= public.tt_today()), '[]'::jsonb),
           (SELECT jsonb_build_object('id', s.id, 'source', s.source, 'rate_cents', s.rate_cents, 'currency', s.currency,
                                      'amount_text', s.amount_text, 'excerpt', s.excerpt, 'created_at', s.created_at)
              FROM public.lodging_rate_suggestions s
             WHERE s.lodging_id = l.id AND s.status = 'pending'
             ORDER BY s.created_at DESC LIMIT 1)
      FROM public.lodging_nodes l
      JOIN public.profiles p ON p.id = auth.uid() AND p.merchant_id = l.merchant_id
     ORDER BY l.name;
$$;
REVOKE ALL ON FUNCTION public.merchant_my_lodging() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.merchant_my_lodging() TO authenticated;

-- Claim links: audit + revoke ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revoke_business_claim(p_merchant_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE n integer;
BEGIN
    IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Admins only.');
    END IF;
    UPDATE public.merchant_invites SET status = 'expired'
     WHERE merchant_id = p_merchant_id AND claims_existing AND status = 'pending';
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO public.business_audit_log (merchant_id, actor, action, detail)
    VALUES (p_merchant_id, auth.uid(), 'claim_link_revoked', jsonb_build_object('links', n));
    RETURN jsonb_build_object('success', true, 'revoked', n);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_revoke_business_claim(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_business_claim(uuid) TO authenticated;

-- Log every claim link minted (same body as 20261026120000 plus the audit row).
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
    v_replaced integer;
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

    UPDATE public.merchant_invites SET status = 'expired'
     WHERE merchant_id = p_merchant_id AND claims_existing AND status = 'pending';
    GET DIAGNOSTICS v_replaced = ROW_COUNT;

    SELECT id INTO v_node FROM public.kiosk_nodes WHERE merchant_id = p_merchant_id ORDER BY created_at LIMIT 1;

    INSERT INTO public.merchant_invites (kiosk_node_id, commander_id, merchant_name, merchant_id, claims_existing, created_by, expires_at)
    VALUES (v_node, NULL, v_merchant.name, p_merchant_id, true, v_uid, now() + make_interval(days => p_days))
    RETURNING token INTO v_token;

    INSERT INTO public.business_audit_log (merchant_id, lodging_id, actor, action, detail)
    VALUES (p_merchant_id, p_lodging_id, v_uid, 'claim_link_created',
            jsonb_build_object('days', p_days, 'replaced_links', v_replaced));

    RETURN jsonb_build_object(
        'success', true,
        'merchant_id', p_merchant_id,
        'business_name', v_merchant.name,
        'invite_token', v_token,
        'claim_url', 'https://g-taxi-868-r1-admin.vercel.app/merchant-onboard?invite=' || v_token::text,
        'expires_at', now() + make_interval(days => p_days)
    );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_create_business_claim(uuid, uuid, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_business_claim(uuid, uuid, integer) TO authenticated;

-- Daily roll-over at 06:00 Trinidad (10:00 UTC), before G proposes packages at 13:00 UTC.
DO $$
BEGIN
    PERFORM cron.unschedule('refresh-lodging-quotes-daily') FROM cron.job WHERE jobname = 'refresh-lodging-quotes-daily';
    PERFORM cron.schedule('refresh-lodging-quotes-daily', '0 10 * * *', 'SELECT public.refresh_all_lodging_quotes()');
END $$;
