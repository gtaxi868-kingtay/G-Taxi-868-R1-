# G868 Shadow-Layer Recovery — README

**Extracted 30 Oct 2026, read-only, from the live database** (project `ffbbuafgeypvkpcuvdnv`) via `pg_get_functiondef` and the system catalogues. Companion to the extras sweep (`~/workspace/your_files/g868-extras-sweep-30oct2026.md`). Nothing was applied, deployed, or written to the database — these files are the disaster-recovery record, to be used ONLY on a fresh rebuild-from-repo, after the repo migrations run.

## Contents

| Part | Count | Files |
|---|---|---|
| Procedures defined nowhere on disk (67) + only on unmerged branches (10) | **77 names, 77 definitions** | `functions/<proname>.sql` (77 files) + combined `shadow_functions_recovery.sql` |
| Tables with no CREATE TABLE in the repo | **25** | `tables/<table>.sql` (25 files) + combined `shadow_tables_recovery.sql` |

The 77-name target list was re-derived independently (live `pg_proc`, extension-owned excluded = 437 names; minus names with a CREATE FUNCTION anywhere in origin/main's `supabase/migrations`, `migrations_archive`, or `backups`) and matched the sweep's 67 + 10 exactly. All 77 definitions were fetched; **all 77 are in `CREATE OR REPLACE` form** — no exceptions to note. No overloaded names were found among the 77 (one definition per name).

## Tables — reconstruction fidelity

DDL was composed from catalogue evidence, not guessed: column types via `pg_catalog.format_type` (exact), defaults and nullability from `information_schema.columns`, 107 constraints via `pg_get_constraintdef`, 35 non-constraint indexes via `pg_get_indexdef`.

Captured exactly, including the easy-to-lose details:

- **Generated columns (3)** — expressions fetched via `pg_get_expr` and embedded as `GENERATED ALWAYS AS (...) STORED`: `driver_leases.weekly_deduction_cents` = `daily_deduction_cents * 7`; `driver_leases.remaining_balance_cents` = `total_lease_cents - paid_to_date_cents` (confirms the lease design: never write this column, advance `paid_to_date_cents` only); `g_memory.search_tsv` = the `to_tsvector('english', title || body)` expression.
- **Identity (1)** — `waitlist_submission_log.id` is `GENERATED ALWAYS AS IDENTITY` (from `pg_attribute.attidentity`).
- **Triggers on these tables (1)** — `trg_normalize_carrier_name` on `carrier_policies`, extracted via `pg_get_triggerdef` into the combined tables file; its function (`normalize_carrier_name`) is itself one of the recovered 77.
- **RLS** — per-table state recorded; where RLS is enabled live, the file carries the `ENABLE ROW LEVEL SECURITY` statement and every live policy's name/cmd/roles/qual/with_check as catalogue-evidence comments (28 policies across the 25 tables).

## What could NOT be extracted faithfully (and why)

1. **RLS policies are evidence, not executable DDL.** Policies are reproduced as comments alongside the ENABLE statement. Before a rebuild relies on them for access control, a human must turn the comments into `CREATE POLICY` statements and check them — qual/with_check text is preserved verbatim to make that possible.
2. **Triggers on OTHER (non-shadow) tables that call these 77 procedures are not included.** The task scope was triggers on the 25 shadow tables (1 found). Some recovered procedures are trigger functions bound elsewhere in the live schema; their bindings live in the repo's own migrations for repo-defined tables, but any binding created straight into the database on a repo-defined table would not be captured here.
3. **Sequences behind `nextval(...)` defaults are not separately dumped.** Where a column default references a sequence, the sequence object itself must exist on a rebuild (normally created alongside its table in the original install). Only one identity column exists among the 25; any plain `nextval` defaults should be checked when the recovery is first test-applied.
4. **Table data, grants, and ownership are out of scope** — this is a schema/procedure recovery, not a backup. Row data, `GRANT`s, and non-default owners are not recorded.
5. Definitions are exactly as `pg_get_functiondef` rendered them on 30 Oct 2026; if the live database changes after this date, this record ages with it.

## Spot-check verification (done at extraction)

- `functions/charge_merchant_pin_fee_batch.sql` — full body present (SECURITY DEFINER, locked-IDs batch logic), matches the register's description of the open pin-fee endpoint's engine.
- `functions/check_driver_insurance_compliance.sql` — signature `(p_driver_id uuid) RETURNS jsonb` present; this is the checker the 29 Oct insurance gate wired in.
- `tables/driver_leases.sql` — both generated columns carry their exact stored expressions.
- `tables/compliance_queue.sql` — columns/defaults match the compliance flow the audits described.
- Counts: 77 function files = 77 combined `CREATE OR REPLACE` statements; 25 table files = the sweep's 25 names, all confirmed present live before extraction.
