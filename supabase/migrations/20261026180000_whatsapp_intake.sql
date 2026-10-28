-- WhatsApp intake queue (Connection Map item 3), the MANUAL version.
--
-- Why manual: nothing in this system can read inbound WhatsApp messages.
-- There is no inbound webhook function, and the WhatsApp Business token is
-- invalid (Meta app deleted, see project memory 2026-10-18). Faking automation
-- would be worse than a structured log, so admin pastes each inbound message
-- (or types the phone + ref) and the admin page recognises the partner ref.
--
-- partner_refs: the partner-page slugs the founder listed (2026-10-26). None
-- of these businesses has a record in the database yet, so merchant_id /
-- lodging_id start empty and admin links them when the business exists (or
-- claims its link). label is left for admin to set: no names are guessed.

CREATE TABLE IF NOT EXISTS public.partner_refs (
    slug        text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
    label       text,
    merchant_id uuid REFERENCES public.merchants(id) ON DELETE SET NULL,
    lodging_id  uuid REFERENCES public.lodging_nodes(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.partner_refs (slug) VALUES
    ('kapok'), ('innat87'), ('fortywinks'), ('jta'), ('persads'), ('buzo'), ('sails'),
    ('venimange'), ('westbees'), ('valsayn'), ('lamer'), ('levisage'), ('hisanna')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.business_intake (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ref_slug      text REFERENCES public.partner_refs(slug) ON DELETE SET NULL,
    kind          text NOT NULL DEFAULT 'connect' CHECK (kind IN ('connect', 'driver_start', 'other')),
    status        text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'linked', 'driver_started', 'closed')),
    contact_name  text,
    contact_phone text,
    message       text,
    notes         text,
    created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_intake_status_idx ON public.business_intake (status, created_at DESC);

ALTER TABLE public.partner_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_intake ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_refs, public.business_intake FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.partner_refs, public.business_intake TO authenticated;
DROP POLICY IF EXISTS "Admin manages partner refs" ON public.partner_refs;
CREATE POLICY "Admin manages partner refs" ON public.partner_refs FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin'));
DROP POLICY IF EXISTS "Admin manages intake" ON public.business_intake;
CREATE POLICY "Admin manages intake" ON public.business_intake FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin'));

CREATE OR REPLACE FUNCTION public.touch_business_intake() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_touch_business_intake ON public.business_intake;
CREATE TRIGGER trg_touch_business_intake BEFORE UPDATE ON public.business_intake
    FOR EACH ROW EXECUTE FUNCTION public.touch_business_intake();
