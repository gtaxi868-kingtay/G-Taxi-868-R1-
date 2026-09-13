-- CONSENT LEDGER — proof that a user accepted a document.
--
-- Both signup screens ask the user to accept terms and pass terms_accepted /
-- terms_accepted_at into supabase.auth.signUp's options.data. Verified live:
-- 0 of 10 auth users carry either key. Nothing was recorded, for anyone.
--
-- Even had it persisted, raw_user_meta_data is USER-WRITABLE via
-- supabase.auth.updateUser({ data: ... }) — a rider can set their own
-- terms_accepted flag. That is not evidence.
--
-- Append-only, per-document, per-VERSION, so publishing new terms does not
-- destroy proof of what was agreed before.
--
-- Two traps this codebase has already been bitten by, both handled:
--   1. A policy without a GRANT is dead — escape_lane_interest could never be
--      written to for exactly that reason.
--   2. Supabase default privileges GRANT ALL on new public tables to
--      anon/authenticated. A first dry run showed a rider able to UPDATE rows
--      because of this. Hence REVOKE ALL first, then GRANT SELECT only.
--
-- Dry-run proven before applying, as a real rider against another user:
--   accepting twice ................... 1 row (no duplicates)
--   rows a rider can SEE .............. 1 of 2 (cannot see others')
--   rows a rider could EDIT ........... blocked by grant
--   rows a rider could DELETE ......... blocked by grant
--   forging a row directly ............ BLOCKED
CREATE TABLE IF NOT EXISTS public.user_consents (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    document     text NOT NULL CHECK (document IN
                   ('terms_of_service','privacy_policy','driver_agreement',
                    'merchant_terms','data_retention','safety_policy')),
    version      text NOT NULL,
    accepted_at  timestamptz NOT NULL DEFAULT now(),
    user_agent   text,
    UNIQUE (user_id, document, version)
);

CREATE INDEX IF NOT EXISTS idx_user_consents_user ON public.user_consents (user_id);
ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS uc_select_own ON public.user_consents;
CREATE POLICY uc_select_own ON public.user_consents
    FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS uc_admin_read ON public.user_consents;
CREATE POLICY uc_admin_read ON public.user_consents
    FOR SELECT TO authenticated
    USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));

-- Deliberately NO update or delete policy: append-only by construction.
REVOKE ALL ON public.user_consents FROM anon, authenticated;
GRANT SELECT ON public.user_consents TO authenticated;

COMMENT ON TABLE public.user_consents IS
'Append-only proof that a user accepted a document, per version. Never add an UPDATE or DELETE policy, and never grant INSERT directly — writes go through record_consent(), which takes the user id from auth.uid(). Auth metadata is user-writable and is NOT acceptable evidence.';

CREATE OR REPLACE FUNCTION public.record_consent(
    p_document text, p_version text, p_user_agent text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE v_id uuid; v_user uuid;
BEGIN
    v_user := auth.uid();
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'Must be signed in to record consent';
    END IF;
    INSERT INTO public.user_consents (user_id, document, version, user_agent)
    VALUES (v_user, p_document, p_version, p_user_agent)
    -- Re-accepting the same version keeps the ORIGINAL timestamp: the date
    -- they first agreed is the fact that matters.
    ON CONFLICT (user_id, document, version)
      DO UPDATE SET accepted_at = user_consents.accepted_at
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_consent(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_consent(text,text,text) TO authenticated;
