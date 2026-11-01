# Release Runbook

## Environments

Configure two protected GitHub environments.

### `staging`

- `SUPABASE_PROJECT_ID` secret: disposable staging project ref
- `SUPABASE_ACCESS_TOKEN` secret
- `SUPABASE_ANON_KEY` secret
- `STAGING_ACCESS_TOKEN` secret for the k6 staging user
- `SUPABASE_URL` variable
- `HEALTHCHECK_URL` variable
- provider sandbox credentials only

### `production`

- `SUPABASE_PROJECT_ID` secret: production project ref
- `SUPABASE_ACCESS_TOKEN` secret
- `HEALTHCHECK_URL` variable
- production provider credentials stored only in Supabase/GitHub secret stores
- required reviewers enabled

Never share service-role, Stripe, WiPay, or other production secret values with
the load-test job.

## Staging Promotion

1. Push the candidate to `develop` or manually run `Deploy Staging`.
2. Wait for typecheck, tests, migration dry-run, migration apply, function deployment, and health check.
3. Run `Load Test Staging` with confirmation `load-staging`.
4. Inspect k6 thresholds and Supabase metrics.
5. Obtain production environment approval.
6. Run `Promote Production` with confirmation `promote`.
7. Run the read-only production health check.

## Database Safety

Use expand/contract migrations:

1. Add new nullable columns, tables, or functions.
2. Deploy code compatible with old and new schema.
3. Backfill in bounded batches.
4. Switch reads and writes.
5. Remove old schema only after supported app versions are retired.

Do not treat a destructive down migration as the rollback plan for money,
wallet, settlement, or payment tables. Roll those changes forward with a
compensating migration.

## Edge Function Rollback

Use `Roll Back Production Functions` only with a known-good commit containing
functions compatible with the production schema. Supply only the affected
function names. Run the production health check after redeployment.

## VPS Slot Promotion

The VPS blue/green helper applies only to HTTP services hosted on the VPS:

```bash
cd infra/vps
./promote-slot.sh green
```

It swaps the configured upstreams, validates Compose, recreates Caddy, and
creates a timestamped `.env` backup. Supabase Edge Functions do not pass
through this proxy.

## Incident Rollback

1. Stop promotion and record the release commit.
2. Check health endpoint, Sentry, function logs, database errors, queue depth, and payment reconciliation.
3. Roll back stateless Edge Functions using the rollback workflow if the schema remains compatible.
4. Roll forward database defects with a compensating migration.
5. Disable affected payment or dispatch capabilities with the existing kill switch if money movement is uncertain.
6. Re-run smoke checks and document the incident before reopening traffic.

## Current Boundary

This repository provides the workflows and scripts, but a human must still
create the Supabase staging project, configure protected GitHub environments,
set provider sandbox credentials, and perform the first staging run.