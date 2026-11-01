# SRE Baseline

Date: 2026-09-11
Scope: pilot first, then measured expansion by zone.

## Capacity Targets

These are initial release gates, not claims about current capacity.

| Workload | Pilot target | Expansion gate |
|---|---:|---:|
| Concurrent active rider sessions | 100 | 1,000 |
| Concurrent online drivers | 50 | 500 |
| Nearby-driver request rate | 10 req/s | 100 req/s |
| Driver-location request rate | 50 req/s | 500 req/s |
| Ride-create/match request rate | 2 req/s | 20 req/s |
| API/edge-function availability | 99.5% monthly | 99.9% monthly |
| Valid request p95 latency | < 1.5 s | < 1.0 s |
| Valid request p99 latency | < 3 s | < 2 s |
| Dispatch assignment p95 | < 10 s | < 5 s |
| Payment webhook processing | < 60 s | < 30 s |
| Critical queue age | < 5 min | < 1 min |
| Recovery point objective | 24 h pilot | 1 h expansion |
| Recovery time objective | 8 h pilot | 2 h expansion |

## SLOs

### Availability

Successful valid requests are responses below HTTP 500. Exclude client-side
4xx responses caused by invalid input, but track 401/403/429 separately.

```text
availability = successful valid requests / valid requests
```

Alert when the 5-minute error rate exceeds 2% and the 1-hour error rate exceeds
0.5%. Page for payment, auth, dispatch, or ride-state failures even when the
global rate is lower.

### Latency

Track p50, p95, and p99 separately for:

- auth/session validation
- nearby drivers
- create/match ride
- driver location update
- ride status transition
- wallet/payment initiation
- payment webhook completion

### Data integrity

The following are zero-tolerance events:

- duplicate payment settlement
- wallet balance created without a ledger entry
- driver payout credited to the wrong identity
- ride state moving backward
- webhook accepted without valid provider signature
- production data used in staging or load tests

## Required Metrics

### Golden signals

- request count by function and status
- request latency p50/p95/p99
- 4xx, 429, and 5xx rates
- active realtime channels and disconnects
- database connections, CPU, locks, slow queries, and transaction age
- Redis latency, errors, memory, and candidate-query fallback count
- dispatch queue depth and oldest item age
- payment webhook age, failures, duplicates, and reconciliation delta
- worker health/readiness status

### Labels

Every metric or log event should include function/service, environment, release
commit, zone where applicable, and a correlation/request ID. Never include
tokens, card details, service-role keys, or raw personal data.

## Alert Policy

- Page immediately: payment integrity, auth outage, dispatch outage, data-loss signal, or health/readiness failure in production.
- Page within 10 minutes: sustained 5xx > 2%, p95 above target for 10 minutes, queue age above 5 minutes, or database connection saturation.
- Ticket next business day: elevated 4xx/429, slow non-critical screens, Redis cache misses, or staging-only failures.
- Every alert must link to the incident runbook and identify a service owner.

Alert thresholds are recorded in [sre-alerts.yml](sre-alerts.yml). They must be
implemented in the selected monitoring system before production launch.

## Failure-Test Rules

Failure tests run only against staging and must use the exact confirmation
`FAILURE_TEST_STAGING`. They must be time-bounded, reversible, and recorded.

Approved first tests:

- stop the blue worker slot and verify Caddy routes to the healthy green slot
- pause Redis and verify readiness becomes 503
- restore Redis and verify readiness returns 200
- replay the same sandbox webhook and verify idempotency
- force a staging edge-function 5xx and verify alert delivery
- simulate a realtime disconnect and verify controlled fallback traffic

Never inject failure into production, payment providers, or the production
database as part of a load or chaos test.

The first failover test is runnable with:

```bash
DEPLOYMENT_ENVIRONMENT=staging \
STAGING_HEALTH_URL=https://staging.example.com/ops/ready \
./scripts/failure-test-staging.sh FAILURE_TEST_STAGING
```