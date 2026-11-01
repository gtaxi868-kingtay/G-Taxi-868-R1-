# Incident Response

## Severity

- **SEV1:** payment/data integrity, auth outage, dispatch unavailable across a zone, or confirmed data loss.
- **SEV2:** major degradation, sustained 5xx/latency breach, queue backlog, or one-zone outage.
- **SEV3:** isolated non-critical feature failure, staging failure, or alert without user impact.

## First 15 Minutes

1. Declare the incident in the team channel and assign incident commander, operations lead, and communications lead.
2. Record start time, affected environment, release commit, zones, and symptoms.
3. Stop deployments and load/failure tests.
4. Check health/readiness, Sentry, Supabase logs/metrics, Redis, queue age, and payment reconciliation.
5. Enable the narrowest kill switch for unsafe payment or dispatch behavior.
6. Preserve logs and provider event IDs; do not edit production ledger rows manually.

## Decision Tree

- **Payment uncertainty:** stop new payment capture/topups, keep read-only wallet views if safe, reconcile provider events, then roll forward with a compensating migration.
- **Redis failure:** verify readiness and fallback rate; prevent an unbounded database scan; restore or fail closed by endpoint policy.
- **Worker slot failure:** confirm Caddy routes to the healthy slot, then inspect the failed container.
- **Bad Edge Function release:** use the rollback workflow only if the previous function is schema-compatible.
- **Database/schema defect:** do not run a destructive down migration; deploy a forward fix after preserving evidence.

## Recovery

1. Verify health, latency, error rates, queue age, and payment reconciliation for 15 minutes.
2. Run the relevant staging regression or sandbox replay.
3. Communicate recovery and remaining restrictions.
4. Open a blameless postmortem within 48 hours with impact, timeline, trigger, detection gap, and preventive action.