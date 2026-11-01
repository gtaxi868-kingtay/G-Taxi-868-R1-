# Disaster Recovery

## Targets

- Pilot RPO: 24 hours; pilot RTO: 8 hours.
- Expansion RPO: 1 hour; expansion RTO: 2 hours.

These targets are not met until a restore drill has been timed and recorded.

The first VPS failover test is separate from database recovery. Run the
staging-only slot test before a restore drill and retain both outputs as
release evidence.

## Backup Policy

- Keep Supabase managed backups/PITR enabled on the production plan.
- Export a schema/recovery artifact before high-risk migration batches.
- Back up VPS Caddy config, Docker Compose, worker configuration template, Redis persistence, and Uptime Kuma data.
- Do not back up secrets into the repository or an unencrypted archive.
- Verify backup age and restoreability daily for metadata and weekly for a full drill.

Create an operational backup without copying secrets:

```bash
BACKUP_ENVIRONMENT=staging \
SUPABASE_DB_URL="$STAGING_DB_URL" \
./scripts/backup-operational-state.sh
```

Production requires the additional explicit confirmation:

```bash
BACKUP_ENVIRONMENT=production \
CONFIRM_PRODUCTION_BACKUP=BACKUP_PRODUCTION \
SUPABASE_DB_URL="$PRODUCTION_DB_URL" \
./scripts/backup-operational-state.sh
```

## Restore Drill

1. Create an isolated restore target; never overwrite production during a drill.
2. Restore the latest database backup or PITR target.
3. Apply only the documented forward migrations required by the target release.
4. Verify auth, RLS, ride state, wallet ledger totals, payment ledger totals, and queue indexes.
5. Restore worker configuration from the secret manager, not from source control.
6. Run smoke checks and record elapsed time, missing objects, and data-loss window.
7. Delete the isolated restore target after evidence is retained.

Before restoring, verify that the archive is intact:

```bash
./scripts/verify-backup.sh backups/staging/<timestamp>
```

This validates checksums, the PostgreSQL archive catalog, and the VPS config
archive. It does not overwrite a database.

## Recovery Ordering

1. DNS/WAF and access controls
2. Supabase project/database/auth
3. Redis/cache and queue consumers
4. Edge Functions
5. VPS workers and monitoring
6. Mobile/backend compatibility verification
7. Payment provider webhook replay and reconciliation

## Exit Criteria

Recovery is complete only when no critical queue is stuck, payment reconciliation
is zero-delta, ride state transitions work, and the incident commander signs off.