# Supabase backups — Rung 0 "Protect the work" (captured 2026-06-23)

Project: `ffbbuafgeypvkpcuvdnv` ("G Taxi DATA BASE", West US / Oregon, Postgres 17.6)

The live database had drifted ~24 migrations ahead of git, with critical objects
(fare calculator, arrival_events ledger, dispatch_queue activation) existing ONLY in the
cloud. These files capture the live truth so the system survives the cloud being lost.

## Files
| File | Committed? | Contents |
|------|-----------|----------|
| `remote_schema_20260623.sql` | ✅ yes | Full `public` schema DDL — tables, RLS policies, functions, triggers, indexes. No data, no secret values. ~1.0 MB. |
| `remote_data_20260623.sql` | ❌ gitignored | Full data dump incl. `auth.users` (emails, password hashes) and all app rows. PII — local disk only. |
| `cron_jobs_20260623.sql` | ❌ gitignored | All 18 pg_cron jobs (the `cron` schema is excluded from `supabase db dump`). Contains a live `x-cron-secret`. |

## How this was made
```
supabase link --project-ref ffbbuafgeypvkpcuvdnv
supabase db dump      -f supabase/backups/remote_schema_20260623.sql   # schema (Docker req'd)
supabase db dump --data-only -f supabase/backups/remote_data_20260623.sql
# cron jobs captured via SQL against cron.job (db dump skips the cron schema)
```

## Restore sketch (if rebuilding from scratch)
1. New project → enable extensions: `postgis`, `pg_cron`, `pg_net`.
2. `psql < remote_schema_20260623.sql` then `psql < remote_data_20260623.sql`.
3. Re-deploy edge functions from `supabase/functions/` (see drift note below).
4. `psql < cron_jobs_20260623.sql` to recreate schedules. Rotate the x-cron-secret first.

## ⚠️ Drift / integrity findings discovered during backup (NOT yet fixed)
- **Migration drift is bidirectional.** Remote has ~24 migrations with no local file
  (the `20260628000002..000020` series: canonical fare calculator, arrival_events,
  dispatch_queue activation, platform_intelligence schedule). Several LOCAL files
  (`20260621000000`, `20260622000000`, `20260625000000`, `20260627000000/01`) were never
  applied to remote under those version stamps. `supabase db pull` was deliberately NOT run
  to avoid generating a conflicting migration; this schema dump is the reconciliation artifact.
- **Edge functions deployed are ahead of git source.** Live: `create_ride` v61,
  `complete_ride` v63, `platform_intelligence` v13, `process_dispatch_queue` v5,
  `estimate_fare` v47. Git/CLAUDE.md claims v59/v59/v11/v3. The deployed Deno source differs
  from what is committed — committed source is NOT a faithful copy of production.
- **`charge_merchant_pin_fees` is broken.** Cron job #34 calls edge function
  `charge_merchant_pin_fees` every 15 min, but that function was never deployed (absent from
  the edge-function list and not a DB function). Phase-2 pin-fee collection is a no-op in prod.
- **`process_dispatch_queue` runs every 1 min** (cron #31), not every 2 min as the phase
  summary stated.
