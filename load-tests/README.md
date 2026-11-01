# Staging Load Tests

These tests are for a disposable staging Supabase project only. They must not run against production or real payment endpoints.

## k6 nearby-driver test

Install k6 using the official package for your operating system, then provide a staging user's access token:

```bash
k6 run \
  -e SUPABASE_URL=https://<staging-project>.supabase.co \
  -e SUPABASE_ANON_KEY=<staging-anon-key> \
  -e STAGING_ACCESS_TOKEN=<short-lived-staging-user-token> \
  load-tests/k6/staging-smoke.js
```

The test ramps through 100, 500, and 1,000 virtual users and exercises the Redis-backed `get_nearby_drivers` function every 10 seconds. It records request failure rate and p95/p99 latency.

## Required follow-up scenarios

Add separate staging-only scenarios before claiming capacity:

- driver location updates with synthetic drivers
- ride creation and matching
- competing ride acceptance
- realtime reconnect storms
- wallet and webhook idempotency using provider sandbox or mocked callbacks

Never put service-role keys in k6 environment variables. The load test should use a short-lived authenticated staging user token and a staging anon key.
