-- Close the last back door around hotel rate periods.
--
-- The admin hotel form (EscapeManagement) wrote lodging_nodes.quoted_* by
-- hand. That skipped the overlap rule and the audit log, and the daily
-- refresh would quietly overwrite it for any hotel with periods. Now:
--  * admin_add_lodging_rate(): admin adds a dated rate through the same
--    _add_rate_period() the hotel uses (source 'admin', audited).
--  * admin_cancel_lodging_rate(): admin cancels one (audited).
--  * A trigger refuses ANY direct change to the quote fields unless it comes
--    from refresh_lodging_quote(), so the package builder can only ever read
--    a rate that exists as an active period.
-- Existing hand-typed quotes (no periods) are left as they are; they simply
-- can't be edited any more except by adding a dated rate.

CREATE OR REPLACE FUNCTION public.refresh_lodging_quote(p_lodging_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
    v_p public.lodging_rate_periods%ROWTYPE;
    v_has_periods boolean;
BEGIN
    SELECT EXISTS (SELECT 1 FROM public.lodging_rate_periods WHERE lodging_id = p_lodging_id) INTO v_has_periods;
    IF NOT v_has_periods THEN RETURN; END IF;
    -- The only door the guard trigger below lets through.
    PERFORM set_config('g868.quote_refresh', 'on', true);
    SELECT * INTO v_p FROM public.lodging_rate_periods
     WHERE lodging_id = p_lodging_id AND status = 'active'
       AND public.tt_today() BETWEEN valid_from AND valid_to
     LIMIT 1;
    IF FOUND THEN
        UPDATE public.lodging_nodes SET
            quoted_rate_per_night_cents = v_p.rate_cents,
            quoted_at = v_p.created_at,
            quoted_by = v_p.created_by,
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
    PERFORM set_config('g868.quote_refresh', 'off', true);
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_lodging_quote(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_lodging_quote() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
    IF COALESCE(current_setting('g868.quote_refresh', true), 'off') = 'on' THEN
        RETURN NEW;
    END IF;
    IF NEW.quoted_rate_per_night_cents IS DISTINCT FROM OLD.quoted_rate_per_night_cents
       OR NEW.quote_expires_at IS DISTINCT FROM OLD.quote_expires_at THEN
        RAISE EXCEPTION 'Room rates are set as dated rates (Rooms & rates, or admin_add_lodging_rate), not typed into the hotel record.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_lodging_quote ON public.lodging_nodes;
CREATE TRIGGER trg_guard_lodging_quote
    BEFORE UPDATE OF quoted_rate_per_night_cents, quote_expires_at ON public.lodging_nodes
    FOR EACH ROW EXECUTE FUNCTION public.guard_lodging_quote();

-- New hotels start with no quote; a quote typed into an INSERT is refused too.
CREATE OR REPLACE FUNCTION public.guard_lodging_quote_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NEW.quoted_rate_per_night_cents IS NOT NULL OR NEW.quote_expires_at IS NOT NULL THEN
        RAISE EXCEPTION 'Add the hotel first, then add its rate as a dated rate.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_lodging_quote_insert ON public.lodging_nodes;
CREATE TRIGGER trg_guard_lodging_quote_insert
    BEFORE INSERT ON public.lodging_nodes
    FOR EACH ROW EXECUTE FUNCTION public.guard_lodging_quote_insert();

CREATE OR REPLACE FUNCTION public.admin_add_lodging_rate(
    p_lodging_id uuid, p_rate_cents integer, p_from date, p_to date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Admins only.');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.lodging_nodes WHERE id = p_lodging_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Hotel not found.');
    END IF;
    RETURN public._add_rate_period(p_lodging_id, p_rate_cents, p_from, p_to, 'admin', auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.admin_add_lodging_rate(uuid, integer, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_lodging_rate(uuid, integer, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_cancel_lodging_rate(p_period_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE v_p public.lodging_rate_periods%ROWTYPE; v_merchant uuid;
BEGIN
    IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Admins only.');
    END IF;
    SELECT * INTO v_p FROM public.lodging_rate_periods WHERE id = p_period_id FOR UPDATE;
    IF NOT FOUND OR v_p.status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'That rate is not active.');
    END IF;
    UPDATE public.lodging_rate_periods SET status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now() WHERE id = p_period_id;
    SELECT merchant_id INTO v_merchant FROM public.lodging_nodes WHERE id = v_p.lodging_id;
    INSERT INTO public.business_audit_log (merchant_id, lodging_id, actor, action, detail)
    VALUES (v_merchant, v_p.lodging_id, auth.uid(), 'rate_cancelled_by_admin',
            jsonb_build_object('period_id', v_p.id, 'rate_cents', v_p.rate_cents, 'from', v_p.valid_from, 'to', v_p.valid_to));
    PERFORM public.refresh_lodging_quote(v_p.lodging_id);
    RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_cancel_lodging_rate(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_lodging_rate(uuid) TO authenticated;

-- The admin edge action 'record_lodging_quote' wrote the quote fields
-- directly; the guard above would now refuse it. Same signature and return
-- shape, but it records a dated admin rate (today for p_validity_days).
CREATE OR REPLACE FUNCTION public.record_lodging_quote(
    p_admin_id uuid, p_lodging_node_id uuid, p_rate_per_night_cents integer, p_contact_note text DEFAULT NULL, p_validity_days integer DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE v_res jsonb; v_days integer := LEAST(GREATEST(COALESCE(p_validity_days, 30), 1), 366);
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND role = 'admin') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Not an admin');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.lodging_nodes WHERE id = p_lodging_node_id) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lodging node not found');
    END IF;
    v_res := public._add_rate_period(p_lodging_node_id, p_rate_per_night_cents, public.tt_today(), public.tt_today() + v_days - 1, 'admin', p_admin_id);
    IF NOT (v_res->>'success')::boolean THEN
        RETURN jsonb_build_object('success', false, 'message', v_res->>'error');
    END IF;
    IF p_contact_note IS NOT NULL THEN
        INSERT INTO public.business_audit_log (merchant_id, lodging_id, actor, action, detail)
        SELECT merchant_id, p_lodging_node_id, p_admin_id, 'admin_quote_note', jsonb_build_object('note', p_contact_note)
          FROM public.lodging_nodes WHERE id = p_lodging_node_id;
    END IF;
    RETURN jsonb_build_object('success', true, 'lodging_node_id', p_lodging_node_id,
        'quote_expires_at', ((public.tt_today() + v_days)::timestamp AT TIME ZONE 'America/Port_of_Spain'),
        'period_id', v_res->>'period_id');
END;
$$;
REVOKE ALL ON FUNCTION public.record_lodging_quote(uuid, uuid, integer, text, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_lodging_quote(uuid, uuid, integer, text, integer) TO service_role;
