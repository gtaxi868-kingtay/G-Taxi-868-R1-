-- ═══════════════════════════════════════════════════════════════════
-- Commander console "Merchants" tab shows the merchants waiting in their
-- territory.
--
-- Before (verified live 2026-10-15): the tab read merchants directly,
-- filtered to its territory and activation_status 'pending'. But RLS only
-- shows merchants with is_active = true (or ones you own/staff), and
-- pending merchants are not active, so the commander saw a partial or empty
-- list (live: 9 pending merchants have a territory).
--
-- After: commander_territory_merchants() returns id, name, category and
-- activation_status for the caller's own territory, only while the caller
-- is an ACTIVE commander. No new access to any other merchant column
-- (bank details, owner, etc.).
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.commander_territory_merchants(p_status text DEFAULT 'pending')
RETURNS TABLE (id uuid, name text, category text, activation_status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT m.id, m.name::text, m.category::text, m.activation_status::text
    FROM public.merchants m
   WHERE m.territory_id IN (SELECT pc.territory_id FROM public.pod_commanders pc
                             WHERE pc.user_id = auth.uid() AND pc.status = 'active'
                               AND pc.territory_id IS NOT NULL)
     AND (p_status IS NULL OR m.activation_status::text = p_status)
   ORDER BY m.created_at DESC;
$function$;

REVOKE ALL ON FUNCTION public.commander_territory_merchants(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commander_territory_merchants(text) TO authenticated;
