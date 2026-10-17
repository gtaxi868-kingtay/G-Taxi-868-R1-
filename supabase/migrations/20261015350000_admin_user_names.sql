-- ═══════════════════════════════════════════════════════════════════
-- Admin screens can show who a ticket / request belongs to.
--
-- Before (verified live 2026-10-15): admin Support embedded
-- profiles:user_id, but support_tickets.user_id points at auth.users, not
-- profiles, so the whole ticket query errored and the page showed zero
-- tickets. Admins also have no read access to other people's profiles.
--
-- After: admin_user_names(ids) returns id, full_name, email, phone_number
-- for the given ids, only when the caller is an admin (role = 'admin').
-- Anyone else gets nothing. No profiles policy is widened.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_user_names(p_ids uuid[])
RETURNS TABLE (id uuid, full_name text, email text, phone_number text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT p.id, p.full_name::text, p.email::text, p.phone_number::text
    FROM public.profiles p
   WHERE p.id = ANY (p_ids)
     AND EXISTS (SELECT 1 FROM public.profiles me
                  WHERE me.id = auth.uid() AND me.role = 'admin'::user_role)
   LIMIT 500;
$function$;

REVOKE ALL ON FUNCTION public.admin_user_names(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_user_names(uuid[]) TO authenticated;
