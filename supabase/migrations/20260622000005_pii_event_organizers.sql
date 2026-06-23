-- ════════════════════════════════════════════════════════════════════════
-- PII / CONFIDENTIAL-FIELD GUARD — event_organizers public read
-- ════════════════════════════════════════════════════════════════════════
-- The "Event organizers are publicly readable" policy is FOR SELECT USING(true)
-- with no role scope, so anon + authenticated could read EVERY column —
-- including two that must never be public:
--   • contact_email     — PII (harvestable by anonymous scrapers)
--   • revshare_percent  — business-confidential (the platform's negotiated rate)
--
-- RLS controls which ROWS are visible; it cannot hide COLUMNS. So we keep the
-- public row policy but restrict column access with column-level GRANTs.
-- Admin tooling reads through service_role (edge functions), which is unaffected.

REVOKE SELECT ON public.event_organizers FROM anon, authenticated;

-- Public-safe columns only — no contact_email, no revshare_percent.
GRANT SELECT (
  id, name, description, logo_url, website_url, is_band, is_active, created_at, updated_at
) ON public.event_organizers TO anon, authenticated;
