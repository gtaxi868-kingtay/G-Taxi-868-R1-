-- PERF: add a covering index for every foreign key that lacks one.
-- 244 unindexed FKs on prod (perf advisor under-counted at 122). Unindexed FKs ->
-- slow joins + slow cascade deletes under load. Catalog-driven + idempotent so it
-- self-applies to prod, fresh clones, and the branching preview alike.
--
-- Covering check uses unnest WITH ORDINALITY (int2vector is 0-indexed, so a naive
-- array slice is off-by-one). Index named from the constraint name to stay unique.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname, cl.relname AS tbl,
      string_agg(quote_ident(a.attname), ', ' ORDER BY k.ord) AS cols
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=cl.relnamespace AND n.nspname='public'
    JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum,ord) ON true
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
    WHERE c.contype='f'
      AND NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid=c.conrelid
          AND (SELECT array_agg(kk ORDER BY o)
               FROM unnest(i.indkey) WITH ORDINALITY t(kk,o)
               WHERE o <= cardinality(c.conkey)) = c.conkey)
    GROUP BY c.conname, cl.relname
  LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (%s)',
      left('ix_'||r.conname,63), r.tbl, r.cols);
  END LOOP;
END $$;
