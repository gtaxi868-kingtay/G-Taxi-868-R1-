# Disaster recovery — schema rebuild

## TL;DR
The live migration history (`supabase/migrations/`, 195 files) does **NOT** replay
from scratch — it accumulated out-of-band drift over time (objects that exist on
prod but were never created by any committed migration). Do **not** rely on it to
rebuild the database.

**`baseline_replayable_20260627.sql` is the source of truth for a from-scratch
rebuild.** It is a full `supabase db dump --linked` of production
(`ffbbuafgeypvkpcuvdnv`) on 2026-06-27, and it **replays clean on an empty DB** —
verified: pushed to a Supabase branch preview which applied it with Database ✅
Services ✅ APIs ✅ Configurations ✅. It includes every object plus this session's
security lockdown, merchant-ownership RLS, 244 FK indexes, and 207 initplan-wrapped
policies.

## To rebuild prod (or stand up a clone) from scratch
```bash
# against an EMPTY database:
psql "$DATABASE_URL" -f supabase/backups/baseline_replayable_20260627.sql
```
That single file recreates the entire public schema. The 195 historical migrations
are NOT needed for a rebuild.

## Why the live migration history can't replay (documented drift)
A from-scratch replay of `supabase/migrations/` fails on objects USED by a migration
but never CREATEd by one (they were added to prod out-of-band). Verified categories:

- **Enum types (7):** user_role, payment_status_enum, payment_method_enum,
  contract_status_type, ledger_party, settlement_method, split_session_status.
  (Bootstrap migration `20260211000000_bootstrap_missing_enums.sql` was added earlier.)
- **Tables (26):** arrival_events, cart_items, document_chunks, documents,
  equity_contracts, generated_documents, incident_reports, itinerary_legs,
  master_escape_itineraries, merchant_promotions, merchant_staff,
  merchant_status_log, organizer_bank_accounts, pool_distributions,
  product_categories, promotion_impressions, property_availability, query_log,
  rate_limits, revshare_payouts, settlement_requests, sos_events, system_settings,
  transit_financial_ledger, wipay_sessions, wipay_transactions.
- **pg_cron:** several migrations `cron.unschedule(<job>)` a job that doesn't exist
  yet on a fresh DB → "could not find valid entry for job". (Existence-guarding them
  in-place fights the Supabase migration runner's statement splitter — avoid;
  the baseline omits cron, schedule jobs separately post-rebuild.)

## Proper long-term fix (gated — needs a human prod decision)
Cut over to the baseline as the single migration:
1. `git mv supabase/migrations/*.sql supabase/migrations_archive/`
2. Add the baseline as `00000000000000_baseline.sql` + a consolidated cron migration.
3. Reconcile PROD's migration ledger so it matches:
   ```bash
   # marks the 195 old versions reverted + the baseline applied — bookkeeping only,
   # does NOT touch data/schema, reversible. PROD write — do deliberately.
   supabase migration repair --status reverted <each old version>
   supabase migration repair --status applied 00000000000000
   ```
This makes the Supabase branch preview go green and a clone-from-migrations work.
NOT done automatically — it rewrites the prod migration ledger. Deploy is already
gated to manual (`deploy_supabase.yml`, #10), so nothing auto-applies.
