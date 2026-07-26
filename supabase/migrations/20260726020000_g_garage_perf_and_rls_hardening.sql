-- ═══════════════════════════════════════════════════════════════════
-- G GARAGE / G SPOT: PERFORMANCE + RLS HARDENING (2026-07-26)
--
-- Found by running get_advisors (security + performance) against the
-- live project right after the G Garage / G Spot migrations shipped —
-- not guessed, not skipped:
--
-- 1) Two SECURITY DEFINER functions (admin_decide_garage_request,
--    g_spot_redeem_drink_subsidy) were granted to `authenticated`,
--    exposing them directly via PostgREST. admin_decide_garage_request
--    trusts a caller-supplied p_admin_id instead of deriving identity
--    from the JWT — exactly the pattern this codebase's own rules
--    forbid. Fixed live already (REVOKE authenticated/anon, GRANT
--    service_role only); this migration keeps the tracked source in
--    sync with what's actually live.
--
-- 2) Four RLS policies called auth.uid()/auth-context functions directly
--    in USING(), which Postgres re-evaluates per row instead of once per
--    query — a real, measurable cost at scale, not just lint noise.
--    Wrapped in (select ...) per Supabase's own documented fix.
--
-- 3) g_spot_venues had two overlapping SELECT-capable policies ("Read
--    active venues" FOR SELECT + "Admins manage venues" FOR ALL), so
--    Postgres evaluated both on every read. Split into one combined
--    SELECT policy and three admin-only write policies (INSERT/UPDATE/
--    DELETE) so there is exactly one applicable policy per action.
--
-- 4) Six foreign keys had no covering index, which is a delete/update-
--    performance ticking time bomb, not just a select-time one.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. Lock down the two RPCs to service_role only ────────────────
REVOKE ALL ON FUNCTION public.admin_decide_garage_request(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_decide_garage_request(uuid, text, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.g_spot_redeem_drink_subsidy(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.g_spot_redeem_drink_subsidy(uuid, integer) TO service_role;

-- ─── 2. RLS: wrap auth function calls so they evaluate once per query ──

DROP POLICY IF EXISTS "Drivers read own garage requests" ON public.g_garage_requests;
CREATE POLICY "Drivers read own garage requests" ON public.g_garage_requests
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_id AND d.user_id = (SELECT auth.uid()))
        OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
    );

DROP POLICY IF EXISTS "Admins manage g_knowledge_documents" ON public.g_knowledge_documents;
CREATE POLICY "Admins manage g_knowledge_documents" ON public.g_knowledge_documents
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
    ) WITH CHECK (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
    );

DROP POLICY IF EXISTS "Members read own membership" ON public.g_spot_memberships;
CREATE POLICY "Members read own membership" ON public.g_spot_memberships
    FOR SELECT USING (
        profile_id = (SELECT auth.uid())
        OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
    );

-- ─── 3. g_spot_venues: split into one SELECT policy + admin-only writes ──

DROP POLICY IF EXISTS "Admins manage venues" ON public.g_spot_venues;
DROP POLICY IF EXISTS "Read active venues" ON public.g_spot_venues;

CREATE POLICY "Read venues" ON public.g_spot_venues
    FOR SELECT USING (
        status = 'active'
        OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
    );

CREATE POLICY "Admins insert venues" ON public.g_spot_venues
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
    );

CREATE POLICY "Admins update venues" ON public.g_spot_venues
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
    ) WITH CHECK (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
    );

CREATE POLICY "Admins delete venues" ON public.g_spot_venues
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
    );

-- ─── 4. Covering indexes for every unindexed foreign key ───────────

CREATE INDEX IF NOT EXISTS idx_g_garage_requests_decided_by ON public.g_garage_requests(decided_by);
CREATE INDEX IF NOT EXISTS idx_g_garage_requests_fleet_lease_id ON public.g_garage_requests(fleet_lease_id);
CREATE INDEX IF NOT EXISTS idx_g_garage_requests_vehicle_class_key ON public.g_garage_requests(vehicle_class_key);
CREATE INDEX IF NOT EXISTS idx_g_knowledge_documents_uploaded_by ON public.g_knowledge_documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_g_spot_memberships_venue_id ON public.g_spot_memberships(venue_id);
CREATE INDEX IF NOT EXISTS idx_g_spot_venues_region_id ON public.g_spot_venues(region_id);

-- Note: idx_g_garage_requests_status and idx_g_spot_memberships_profile
-- (added in the first migration) show as "unused" in the performance
-- advisor — expected at zero real rows/zero real traffic so far, not a
-- design flaw. Left in place: both back real query patterns already in
-- GGarage.tsx (status='pending' filter) and the driver-facing membership
-- lookup, and will show as used once real data flows through them.

NOTIFY pgrst, 'reload schema';
