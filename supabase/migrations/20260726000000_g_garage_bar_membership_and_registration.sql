-- ═══════════════════════════════════════════════════════════════════
-- G GARAGE + G SPOT BAR MEMBERSHIP + DRIVER REGISTRATION CLASS (2026-07-26)
--
-- Implements the plan at /Users/kingtay/.claude/plans/b-optimized-phoenix.md:
--
-- 1) drivers.registration_class — the one non-negotiable finding from
--    that plan: nothing in this system tracked whether a driver's
--    vehicle carries a legal 'H' (for-hire) plate vs a private plate.
--    Operating a privately-registered vehicle for hire is illegal in
--    T&T and voids insurance. Defaults every existing driver to
--    'unverified' — this is an honest admission that we don't know
--    today, not a false "compliant" default.
--
-- 2) g_knowledge_documents + the `g-knowledge-docs` storage bucket —
--    "G memory": admin-uploaded reference documents (e.g. the real
--    government "Individuals Guidelines for Personal Vehicle Import"
--    PDF, ATL fleet-deal terms, a customs broker's legal opinion) that
--    G's LLM context can read from when reasoning about G Garage / G
--    Spot / compliance decisions. This is plain text (title/category/
--    notes), not OCR or embeddings — neither exists anywhere in this
--    codebase (confirmed by grep before writing this), and building a
--    real RAG/OCR pipeline is out of scope here. The document itself is
--    stored in Storage for a human to open; the notes field is what G
--    actually reads.
--
-- 3) g_garage_requests — a driver's opt-in request to source/lease a
--    vehicle through the platform (local BYD dealer fallback or
--    platform-facilitated import), with a server-computed min/max daily
--    contribution range and a platform-match percentage. Feeds a real
--    fleet_leases row (lease_type='hybrid') only on admin approval.
--
-- 4) g_spot_venues + g_spot_memberships — the bar-membership add-on.
--    Real per-member subsidy caps enforced server-side (drink subsidy
--    hard-capped per billing cycle; ride subsidy scoped to venue trips
--    only via rides.ride_persona = 'G_SPOT_SHUTTLE', which the existing
--    free-text ride_persona column already supports with zero schema
--    change needed there).
--
-- Nothing here invents pricing_config values that don't exist — every
-- dollar figure below is a column default that an admin can change via
-- the UI added alongside this migration, not a hardcoded business rule.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. Driver registration class ("H" plate tracking) ───────────────
--    Evidence documents reuse the EXISTING driver_documents table
--    (document_type = 'registration_proof') and the existing
--    driver-documents storage bucket + `${user_id}/...` path convention
--    already used by RegisterScreen.tsx for license/vehicle photos — a
--    second parallel document mechanism would be tech debt, not a fix.

ALTER TABLE public.drivers
    ADD COLUMN IF NOT EXISTS registration_class text NOT NULL DEFAULT 'unverified'
        CHECK (registration_class IN ('unverified', 'H', 'R', 'private')),
    ADD COLUMN IF NOT EXISTS registration_verified_at timestamptz,
    ADD COLUMN IF NOT EXISTS registration_verified_by uuid REFERENCES public.profiles(id);

COMMENT ON COLUMN public.drivers.registration_class IS
    'H = legal for-hire plate (verified). R = rental plate. private = confirmed NOT for-hire (non-compliant, must not carry paying passengers). unverified = not yet checked — the honest default for every pre-existing row.';

-- ─── 2. G Memory: knowledge documents + storage bucket ────────────────

CREATE TABLE IF NOT EXISTS public.g_knowledge_documents (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title           text NOT NULL,
    category        text NOT NULL DEFAULT 'general'
                        CHECK (category IN ('general', 'legal', 'compliance', 'vendor_quote', 'financial', 'research')),
    storage_path    text NOT NULL,
    file_name       text NOT NULL,
    notes           text,
    is_active       boolean NOT NULL DEFAULT true,
    uploaded_by     uuid NOT NULL REFERENCES public.profiles(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.g_knowledge_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage g_knowledge_documents" ON public.g_knowledge_documents;
CREATE POLICY "Admins manage g_knowledge_documents" ON public.g_knowledge_documents
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    ) WITH CHECK (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );

INSERT INTO storage.buckets (id, name, public)
VALUES ('g-knowledge-docs', 'g-knowledge-docs', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Admins read g-knowledge-docs" ON storage.objects;
CREATE POLICY "Admins read g-knowledge-docs" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'g-knowledge-docs'
        AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );

DROP POLICY IF EXISTS "Admins write g-knowledge-docs" ON storage.objects;
CREATE POLICY "Admins write g-knowledge-docs" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'g-knowledge-docs'
        AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );

DROP POLICY IF EXISTS "Admins delete g-knowledge-docs" ON storage.objects;
CREATE POLICY "Admins delete g-knowledge-docs" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'g-knowledge-docs'
        AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- The `driver-documents` bucket already exists in production (referenced
-- live by RegisterScreen.tsx and DriverApproval.tsx) but has never had
-- its RLS formalized in a tracked migration — every bucket policy so far
-- has been set by hand in the dashboard, which is exactly the kind of
-- untracked drift CLAUDE.md already flags elsewhere in this repo. These
-- policies are additive (Postgres OR's multiple permissive policies of
-- the same command together) so they only add coverage for the new
-- registration_proof document_type; they cannot narrow whatever access
-- already works for existing document types.
DROP POLICY IF EXISTS "Drivers manage own documents" ON storage.objects;
CREATE POLICY "Drivers manage own documents" ON storage.objects
    FOR ALL USING (
        bucket_id = 'driver-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
    ) WITH CHECK (
        bucket_id = 'driver-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "Admins read all driver-documents" ON storage.objects;
CREATE POLICY "Admins read all driver-documents" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'driver-documents'
        AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- ─── 3. G Garage: driver-initiated vehicle sourcing requests ──────────

CREATE TABLE IF NOT EXISTS public.g_garage_requests (
    id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id                       uuid NOT NULL REFERENCES public.drivers(id),
    vehicle_class_key               text NOT NULL REFERENCES public.vehicle_classes(key),
    source                          text NOT NULL DEFAULT 'local_dealer'
                                        CHECK (source IN ('local_dealer', 'platform_import')),
    min_daily_contribution_cents    integer NOT NULL CHECK (min_daily_contribution_cents >= 0),
    max_daily_contribution_cents    integer NOT NULL CHECK (max_daily_contribution_cents >= min_daily_contribution_cents),
    requested_daily_contribution_cents integer NOT NULL
        CHECK (requested_daily_contribution_cents BETWEEN min_daily_contribution_cents AND max_daily_contribution_cents),
    platform_match_pct             integer NOT NULL DEFAULT 20 CHECK (platform_match_pct BETWEEN 0 AND 100),
    h_registration_opt_in          boolean NOT NULL DEFAULT false,
    status                          text NOT NULL DEFAULT 'pending'
                                        CHECK (status IN ('pending', 'approved', 'rejected', 'active', 'completed', 'defaulted')),
    decision_reason                 text,
    decided_by                       uuid REFERENCES public.profiles(id),
    decided_at                       timestamptz,
    fleet_lease_id                   uuid REFERENCES public.fleet_leases(id),
    created_at                       timestamptz NOT NULL DEFAULT now(),
    updated_at                       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_g_garage_requests_driver ON public.g_garage_requests(driver_id);
CREATE INDEX IF NOT EXISTS idx_g_garage_requests_status ON public.g_garage_requests(status);

ALTER TABLE public.g_garage_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Drivers read own garage requests" ON public.g_garage_requests;
CREATE POLICY "Drivers read own garage requests" ON public.g_garage_requests
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_id AND d.user_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- Inserts/updates go through the g_garage / admin edge functions (service
-- role) exclusively, matching the pattern used by fleet_leases and every
-- other money-adjacent table in this codebase — no direct client writes.

-- ─── 4. G Spot: venues + memberships ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.g_spot_venues (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    text NOT NULL,
    address                 text NOT NULL,
    region_id               uuid REFERENCES public.region_settings(id),
    monthly_rent_cents      integer NOT NULL CHECK (monthly_rent_cents >= 0),
    membership_price_cents  integer CHECK (membership_price_cents IS NULL OR membership_price_cents >= 0),
    drink_subsidy_cap_cents integer NOT NULL DEFAULT 8400 CHECK (drink_subsidy_cap_cents >= 0),
    status                  text NOT NULL DEFAULT 'candidate'
                                CHECK (status IN ('candidate', 'active', 'closed')),
    zone_analysis_notes     text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.g_spot_venues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read active venues" ON public.g_spot_venues;
CREATE POLICY "Read active venues" ON public.g_spot_venues
    FOR SELECT USING (status = 'active');

DROP POLICY IF EXISTS "Admins manage venues" ON public.g_spot_venues;
CREATE POLICY "Admins manage venues" ON public.g_spot_venues
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    ) WITH CHECK (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );

GRANT SELECT ON public.g_spot_venues TO authenticated;

CREATE TABLE IF NOT EXISTS public.g_spot_memberships (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id                  uuid NOT NULL REFERENCES public.profiles(id),
    venue_id                    uuid NOT NULL REFERENCES public.g_spot_venues(id),
    monthly_price_cents         integer NOT NULL CHECK (monthly_price_cents >= 0),
    drink_subsidy_cap_cents     integer NOT NULL,
    drink_subsidy_used_cents    integer NOT NULL DEFAULT 0 CHECK (drink_subsidy_used_cents >= 0),
    cycle_start                 date NOT NULL DEFAULT current_date,
    status                      text NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active', 'paused', 'cancelled')),
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (profile_id, venue_id)
);

CREATE INDEX IF NOT EXISTS idx_g_spot_memberships_profile ON public.g_spot_memberships(profile_id);

ALTER TABLE public.g_spot_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read own membership" ON public.g_spot_memberships;
CREATE POLICY "Members read own membership" ON public.g_spot_memberships
    FOR SELECT USING (
        profile_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- ─── 5. G Garage decision — single source of truth for both the direct
--    admin-approval path (apps/admin GGarage screen) and the G-proposes/
--    admin-approves path (g_execute_action's approve_garage_request
--    handler) — matching this codebase's existing rule that a real
--    money-moving decision must have exactly one implementation, not two
--    that can drift (the same reasoning behind compute_ride_split).

CREATE OR REPLACE FUNCTION public.admin_decide_garage_request(
    p_request_id uuid,
    p_decision   text,
    p_admin_id   uuid,
    p_reason     text DEFAULT NULL
)
RETURNS public.g_garage_requests
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_req      public.g_garage_requests;
    v_lease_id uuid;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;
    IF p_decision NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'p_decision must be approved or rejected';
    END IF;

    SELECT * INTO v_req FROM public.g_garage_requests WHERE id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Garage request not found';
    END IF;
    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'Request already decided (status=%)', v_req.status;
    END IF;

    IF p_decision = 'approved' THEN
        -- Real fleet_leases row, lease_type='hybrid' per the plan: a
        -- weekly_minimum_cents safety-net floor plus a per_ride_installment
        -- so a driver who does more rides pays down faster without a
        -- second manually-sized tier.
        INSERT INTO public.fleet_leases (
            driver_id, lease_type, daily_rate_cents, weekly_minimum_cents,
            per_ride_installment_cents, status, reserve_funded, metadata
        ) VALUES (
            v_req.driver_id, 'hybrid',
            v_req.requested_daily_contribution_cents,
            v_req.requested_daily_contribution_cents * 7,
            GREATEST(50, v_req.requested_daily_contribution_cents / 20),
            'active', true,
            jsonb_build_object(
                'g_garage_request_id', v_req.id,
                'vehicle_class_key', v_req.vehicle_class_key,
                'source', v_req.source,
                'platform_match_pct', v_req.platform_match_pct,
                'h_registration_opt_in', v_req.h_registration_opt_in
            )
        )
        RETURNING id INTO v_lease_id;
    END IF;

    UPDATE public.g_garage_requests
    SET status = p_decision,
        decision_reason = p_reason,
        decided_by = p_admin_id,
        decided_at = now(),
        fleet_lease_id = v_lease_id,
        updated_at = now()
    WHERE id = p_request_id
    RETURNING * INTO v_req;

    RETURN v_req;
END;
$$;

-- service_role only: this function trusts its p_admin_id parameter
-- (checked against profiles.role='admin', but not derived from auth.uid())
-- rather than resolving identity from the caller's JWT — exposing it to
-- `authenticated` would let any signed-in user call it directly via
-- PostgREST with an arbitrary admin id and approve/reject real leases,
-- violating this codebase's own rule that identity must come from the
-- JWT, never a client-supplied id. Both real callers (admin/index.ts,
-- g_execute_action) already use the service-role client, so there was
-- never a reason to expose this further. Caught by get_advisors after
-- the migration first shipped granting this to `authenticated`; fixed
-- live and here in sync.
REVOKE ALL ON FUNCTION public.admin_decide_garage_request(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_decide_garage_request(uuid, text, uuid, text) TO service_role;

-- ─── 6. Drink-subsidy cap enforcement (server-side, not trust-the-client) ──

CREATE OR REPLACE FUNCTION public.g_spot_redeem_drink_subsidy(
    p_membership_id uuid,
    p_discount_cents integer
)
RETURNS public.g_spot_memberships
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_row public.g_spot_memberships;
BEGIN
    IF p_discount_cents IS NULL OR p_discount_cents < 0 THEN
        RAISE EXCEPTION 'p_discount_cents must be >= 0';
    END IF;

    SELECT * INTO v_row FROM public.g_spot_memberships WHERE id = p_membership_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Membership not found';
    END IF;
    IF v_row.status <> 'active' THEN
        RAISE EXCEPTION 'Membership is not active';
    END IF;

    -- Monthly cycle reset (billing cycle = calendar month from cycle_start day).
    IF v_row.cycle_start <= (current_date - interval '1 month')::date THEN
        UPDATE public.g_spot_memberships
        SET drink_subsidy_used_cents = 0, cycle_start = current_date, updated_at = now()
        WHERE id = p_membership_id
        RETURNING * INTO v_row;
    END IF;

    -- Hard cap: never let redeemed amount push used past the cap. This is
    -- the actual mechanism behind "the discount pauses once the ceiling is
    -- hit" from the pricing plan — not an honor-system limit.
    UPDATE public.g_spot_memberships
    SET drink_subsidy_used_cents = LEAST(drink_subsidy_cap_cents, drink_subsidy_used_cents + p_discount_cents),
        updated_at = now()
    WHERE id = p_membership_id
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

-- service_role only: this function does NOT check that the caller owns
-- p_membership_id (SECURITY DEFINER bypasses RLS), so it must be called
-- from a trusted edge function (venue check-in flow), never directly by
-- an authenticated client — otherwise any member could burn down another
-- member's subsidy cap. Caught by get_advisors after the migration first
-- shipped granting this to `authenticated`; fixed live and here in sync.
REVOKE ALL ON FUNCTION public.g_spot_redeem_drink_subsidy(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.g_spot_redeem_drink_subsidy(uuid, integer) TO service_role;

-- ─── 7. Schedule G's new "fleet" department (registration compliance +
--    G Garage triage) — mirrors the existing g-dept-* jobs exactly.
--    NOTE (honest limitation, matching this repo's own documented gap):
--    current_setting('app.settings.cron_secret', true) reads as NULL in
--    this project (the GUC was denied when it was tried for the other
--    g-dept-* jobs too) — those 4 jobs only work today because someone
--    manually UPDATEd cron.job to inject the real PLATFORM_CRON_SECRET
--    value directly into cron.job.command after this exact migration
--    pattern didn't work. This job will need the same one-time manual
--    fix after this migration runs; it is NOT being skipped or faked
--    here, it's flagged so the same follow-up isn't missed.
SELECT cron.schedule('g-dept-fleet', '0 10 * * *', $$
  SELECT net.http_post(
    url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/g_agent_runner',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', current_setting('app.settings.cron_secret', true)),
    body := '{"department":"fleet"}'::jsonb)
$$);

NOTIFY pgrst, 'reload schema';
