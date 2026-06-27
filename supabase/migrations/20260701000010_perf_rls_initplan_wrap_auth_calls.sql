-- PERF: wrap auth.uid()/auth.role()/auth.jwt() in (select ...) inside RLS policies
-- so Postgres evaluates them ONCE per query (initplan) instead of once per row.
-- 207 policies across 120 tables on prod. Semantically identical (value is constant
-- within a statement). Atomic: any failure rolls back the whole migration so RLS is
-- never left partially rewritten. Idempotent: skips policies already wrapped.
DO $$
DECLARE
  r record; v_create text; v_roles text; v_cmd text;
BEGIN
  FOR r IN
    SELECT p.polname, c.relname AS tbl, p.polpermissive, p.polcmd, p.polroles,
           pg_get_expr(p.polqual, p.polrelid)     AS qual,
           pg_get_expr(p.polwithcheck, p.polrelid) AS wcheck
    FROM pg_policy p
    JOIN pg_class c ON c.oid=p.polrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
    WHERE (pg_get_expr(p.polqual,p.polrelid)     ~ 'auth\.(uid|role|jwt)\(\)'
        OR pg_get_expr(p.polwithcheck,p.polrelid) ~ 'auth\.(uid|role|jwt)\(\)')
      AND NOT (coalesce(pg_get_expr(p.polqual,p.polrelid),'')
             ||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') ~* '\(\s*select\s+auth\.')
  LOOP
    SELECT string_agg(
             CASE WHEN rid=0 THEN 'public'
                  ELSE quote_ident((SELECT rolname FROM pg_roles WHERE oid=rid)) END, ', ')
      INTO v_roles FROM unnest(r.polroles) rid;

    v_cmd := CASE r.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                           WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END;

    v_create := format('CREATE POLICY %I ON public.%I AS %s FOR %s TO %s',
                  r.polname, r.tbl,
                  CASE WHEN r.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
                  v_cmd, v_roles);

    IF r.qual IS NOT NULL THEN
      v_create := v_create || ' USING ('
        || regexp_replace(r.qual, 'auth\.(uid|role|jwt)\(\)', '(select auth.\1())', 'g') || ')';
    END IF;
    IF r.wcheck IS NOT NULL THEN
      v_create := v_create || ' WITH CHECK ('
        || regexp_replace(r.wcheck, 'auth\.(uid|role|jwt)\(\)', '(select auth.\1())', 'g') || ')';
    END IF;

    EXECUTE format('DROP POLICY %I ON public.%I', r.polname, r.tbl);
    EXECUTE v_create;
  END LOOP;
END $$;
