-- Security-advisor hardening (2026-06-29)
-- Source: Supabase security advisor sweep on prod (ffbbuafgeypvkpcuvdnv).
-- Two real, low-risk findings addressed. Idempotent. Goes through CI/gated deploy
-- (NOT a direct prod write). Other advisor findings were assessed and intentionally
-- left as-is:
--   * spatial_ref_sys RLS-disabled (ERROR): PostGIS extension-owned reference table,
--     cannot enable RLS, no user data — benign known Supabase false-positive.
--   * st_estimatedextent anon-executable SECURITY DEFINER: PostGIS built-ins, no row data.
--   * reserve_health RLS-enabled-no-policy: server/service-role only, correctly locked.
--   * waitlist always-true INSERT: by design for a public "join waitlist" form (INSERT-only,
--     does not expose existing rows).

-- ---------------------------------------------------------------------------
-- 1) agent_decision_log: RLS was enabled with NO policy, so the admin dashboard
--    (apps/admin Intelligence.tsx + Progression.tsx) — which reads AND inserts this
--    table via the authenticated admin client — silently got zero rows / blocked inserts.
--    Add the same admin-scoped policy used by 30+ other tables. Service-role writes from
--    edge functions (platform_intelligence) are unaffected (service role bypasses RLS).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin full access agent_decision_log" ON "public"."agent_decision_log";
CREATE POLICY "Admin full access agent_decision_log"
  ON "public"."agent_decision_log"
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
     FROM "public"."profiles"
    WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid"))
       AND ("profiles"."role" = 'admin'::"public"."user_role")))));

-- ---------------------------------------------------------------------------
-- 2) hot_zones materialized view was selectable by anon/authenticated via the REST API
--    but is read by NO client app and NO edge function. Revoke direct API access; if a
--    surge/heatmap feature ever needs it, serve it through an edge function.
-- ---------------------------------------------------------------------------
REVOKE SELECT ON "public"."hot_zones" FROM "anon";
REVOKE SELECT ON "public"."hot_zones" FROM "authenticated";
