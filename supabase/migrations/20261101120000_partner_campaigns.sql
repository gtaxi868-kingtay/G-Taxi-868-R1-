-- Partner brand approval: G 868 makes a business's look and packages, and they
-- show on that business's map pin only once the other side has approved them.
-- The rule: whoever did not write it approves it. G 868 drafts, the business
-- approves. The business edits, G 868 approves. Nothing goes live unreviewed.
--
-- approve_on_behalf exists because most partners have no owner account yet
-- (merchants.created_by is NULL on half the live rows) and will say yes over
-- WhatsApp. It is admin-only and keeps the note saying who approved and how.
--
-- No billing and no push here. Riders see a live offer on the pin; a marketing
-- push needs a rider opt-in, which does not exist yet.

CREATE TABLE IF NOT EXISTS public.partner_campaigns (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id      uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    headline         text NOT NULL CHECK (char_length(btrim(headline)) BETWEEN 3 AND 60),
    offer_text       text CHECK (offer_text IS NULL OR char_length(offer_text) <= 140),
    image_url        text CHECK (image_url IS NULL OR image_url ~ '^https://'),
    accent_color     text NOT NULL DEFAULT '#8B5CF6' CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
    audience         text NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone', 'my_clients')),
    starts_on        date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Port_of_Spain')::date),
    ends_on          date,
    status           text NOT NULL CHECK (status IN ('awaiting_business', 'awaiting_g868', 'changes_requested', 'live', 'paused', 'ended')),
    authored_by_side text NOT NULL CHECK (authored_by_side IN ('g868', 'business')),
    paused_by_side   text CHECK (paused_by_side IN ('g868', 'business')),
    change_note      text,
    created_by       uuid NOT NULL,
    decided_by       uuid,
    decided_at       timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT partner_campaigns_dates CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_campaigns_one_live
    ON public.partner_campaigns (merchant_id) WHERE status = 'live';
CREATE INDEX IF NOT EXISTS partner_campaigns_merchant
    ON public.partner_campaigns (merchant_id, created_at DESC);

ALTER TABLE public.partner_campaigns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_campaigns FROM anon, authenticated;
GRANT SELECT ON public.partner_campaigns TO authenticated;

-- Writes go through the two functions below, never straight to the table.
DROP POLICY IF EXISTS "Admin and owner read campaigns" ON public.partner_campaigns;
CREATE POLICY "Admin and owner read campaigns" ON public.partner_campaigns
    FOR SELECT TO authenticated
    USING (
        (SELECT p.role::text FROM public.profiles p WHERE p.id = auth.uid()) = 'admin'
        OR EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = merchant_id AND m.created_by = auth.uid())
    );

-- Which side the caller is on for this business. Identity comes from the JWT.
CREATE OR REPLACE FUNCTION public.partner_campaign_side(p_merchant_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF (SELECT role::text FROM public.profiles WHERE id = auth.uid()) = 'admin' THEN
        RETURN 'g868';
    END IF;
    IF EXISTS (SELECT 1 FROM public.merchants WHERE id = p_merchant_id AND created_by = auth.uid()) THEN
        RETURN 'business';
    END IF;
    RAISE EXCEPTION 'Forbidden: not the owner of this business';
END;
$function$;

CREATE OR REPLACE FUNCTION public.partner_campaign_save(
    p_merchant_id  uuid,
    p_headline     text,
    p_offer_text   text DEFAULT NULL,
    p_image_url    text DEFAULT NULL,
    p_accent_color text DEFAULT '#8B5CF6',
    p_audience     text DEFAULT 'everyone',
    p_starts_on    date DEFAULT NULL,
    p_ends_on      date DEFAULT NULL,
    p_campaign_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_side   text := public.partner_campaign_side(p_merchant_id);
    v_status text := CASE WHEN v_side = 'g868' THEN 'awaiting_business' ELSE 'awaiting_g868' END;
    v_today  date := (now() AT TIME ZONE 'America/Port_of_Spain')::date;
    v_id     uuid;
BEGIN
    IF p_campaign_id IS NULL THEN
        INSERT INTO public.partner_campaigns (merchant_id, headline, offer_text, image_url, accent_color,
            audience, starts_on, ends_on, status, authored_by_side, created_by)
        VALUES (p_merchant_id, btrim(p_headline), NULLIF(btrim(p_offer_text), ''), NULLIF(btrim(p_image_url), ''),
            p_accent_color, p_audience, COALESCE(p_starts_on, v_today), p_ends_on, v_status, v_side, auth.uid())
        RETURNING id INTO v_id;
    ELSE
        -- A live campaign is never edited in place: what riders see must be
        -- exactly what was approved, so a change starts a new version.
        UPDATE public.partner_campaigns
           SET headline = btrim(p_headline), offer_text = NULLIF(btrim(p_offer_text), ''),
               image_url = NULLIF(btrim(p_image_url), ''), accent_color = p_accent_color, audience = p_audience,
               starts_on = COALESCE(p_starts_on, starts_on), ends_on = p_ends_on, status = v_status,
               authored_by_side = v_side, change_note = NULL, updated_at = now()
         WHERE id = p_campaign_id AND merchant_id = p_merchant_id
           AND status IN ('awaiting_business', 'awaiting_g868', 'changes_requested')
        RETURNING id INTO v_id;
        IF v_id IS NULL THEN
            RAISE EXCEPTION 'This version can no longer be edited';
        END IF;
    END IF;
    RETURN jsonb_build_object('id', v_id, 'status', v_status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.partner_campaign_decide(p_id uuid, p_decision text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_row    public.partner_campaigns;
    v_side   text;
    v_status text;
    v_paused text;
    v_note   text := NULLIF(btrim(p_note), '');
BEGIN
    IF p_decision NOT IN ('approve', 'approve_on_behalf', 'request_changes', 'pause', 'resume', 'end') THEN
        RAISE EXCEPTION 'Unknown decision';
    END IF;

    SELECT * INTO v_row FROM public.partner_campaigns WHERE id = p_id FOR UPDATE;
    IF v_row.id IS NULL THEN
        RAISE EXCEPTION 'Campaign not found';
    END IF;
    v_side := public.partner_campaign_side(v_row.merchant_id);

    IF p_decision = 'approve' THEN
        IF NOT ((v_row.status = 'awaiting_business' AND v_side = 'business')
             OR (v_row.status = 'awaiting_g868' AND v_side = 'g868')) THEN
            RAISE EXCEPTION 'Only the other side can approve this version';
        END IF;
        v_status := 'live';
    ELSIF p_decision = 'approve_on_behalf' THEN
        IF v_side <> 'g868' OR v_row.status <> 'awaiting_business' THEN
            RAISE EXCEPTION 'Only G 868 can record a business approval, on a version awaiting one';
        END IF;
        IF char_length(COALESCE(v_note, '')) < 10 THEN
            RAISE EXCEPTION 'Say who approved it and how';
        END IF;
        v_status := 'live';
    ELSIF p_decision = 'request_changes' THEN
        IF NOT ((v_row.status = 'awaiting_business' AND v_side = 'business')
             OR (v_row.status = 'awaiting_g868' AND v_side = 'g868')) THEN
            RAISE EXCEPTION 'Only the side reviewing this version can send it back';
        END IF;
        IF v_note IS NULL THEN
            RAISE EXCEPTION 'Say what needs to change';
        END IF;
        v_status := 'changes_requested';
    ELSIF p_decision = 'pause' THEN
        IF v_row.status <> 'live' THEN
            RAISE EXCEPTION 'Only a live campaign can be paused';
        END IF;
        v_status := 'paused';
        v_paused := v_side;
    ELSIF p_decision = 'resume' THEN
        -- G 868 pausing something for review must hold, and so must an owner's
        -- pause: only the side that paused can bring it back.
        IF v_row.status <> 'paused' OR v_row.paused_by_side <> v_side THEN
            RAISE EXCEPTION 'Only the side that paused this can resume it';
        END IF;
        v_status := 'live';
    ELSE
        IF v_row.status = 'ended' THEN
            RAISE EXCEPTION 'Already ended';
        END IF;
        v_status := 'ended';
    END IF;

    IF v_status = 'live' THEN
        UPDATE public.partner_campaigns SET status = 'ended', updated_at = now()
         WHERE merchant_id = v_row.merchant_id AND status = 'live' AND id <> v_row.id;
    END IF;

    UPDATE public.partner_campaigns
       SET status = v_status, paused_by_side = v_paused, change_note = COALESCE(v_note, change_note),
           decided_by = auth.uid(), decided_at = now(), updated_at = now()
     WHERE id = v_row.id;

    RETURN jsonb_build_object('id', v_row.id, 'status', v_status);
END;
$function$;

-- What a rider sees on the pins they already have. A my_clients offer shows
-- only to someone with history at that business.
CREATE OR REPLACE FUNCTION public.partner_offers_for_rider(p_merchant_ids uuid[])
RETURNS TABLE(merchant_id uuid, headline text, offer_text text, image_url text, accent_color text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT c.merchant_id, c.headline, c.offer_text, c.image_url, c.accent_color
      FROM public.partner_campaigns c
      JOIN public.merchants m ON m.id = c.merchant_id
     WHERE c.merchant_id = ANY (p_merchant_ids[1:50])
       AND c.status = 'live'
       AND m.is_active = true AND m.activation_status = 'active'
       AND (now() AT TIME ZONE 'America/Port_of_Spain')::date >= c.starts_on
       AND (c.ends_on IS NULL OR (now() AT TIME ZONE 'America/Port_of_Spain')::date <= c.ends_on)
       AND (c.audience = 'everyone' OR EXISTS (
            SELECT 1 FROM public.user_service_history h
             WHERE h.merchant_id = c.merchant_id AND h.user_id = auth.uid()));
$function$;

REVOKE ALL ON FUNCTION public.partner_campaign_side(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_campaign_save(uuid, text, text, text, text, text, date, date, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_campaign_decide(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_offers_for_rider(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_campaign_save(uuid, text, text, text, text, text, date, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_campaign_decide(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_offers_for_rider(uuid[]) TO authenticated;
