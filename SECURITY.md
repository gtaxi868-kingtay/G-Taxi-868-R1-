# Security & Secrets Configuration

## Required Supabase Edge Function Secrets

These must be configured in the Supabase project dashboard under
**Settings > Edge Functions > Environment Secrets**. Without them,
the corresponding features fail gracefully (log a warning) but will
be non-functional.

| Variable | Required | Feature | Status |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | All edge functions | **MISSING** |
| `STRIPE_SECRET_KEY` | Yes | Payment processing | **MISSING** |
| `STRIPE_WEBHOOK_SECRET` | Yes | Stripe webhook verification | **MISSING** |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Yes | Push notifications (FCM) | **MISSING** |
| `TWILIO_ACCOUNT_SID` | No | SMS (driver/rider alerts) | **MISSING** |
| `TWILIO_AUTH_TOKEN` | No | SMS | **MISSING** |
| `TWILIO_PROXY_SERVICE_SID` | No | SMS | **MISSING** |
| `SENTRY_DSN` | No | Error reporting | **MISSING** |
| `UPSTASH_REDIS_REST_URL` | No | Driver location cache | **MISSING** |
| `UPSTASH_REDIS_REST_TOKEN` | No | Driver location cache | **MISSING** |

## Deployment Prerequisites

Before any public launch, all secrets flagged "Yes" above must be set.
The remaining "No" secrets are optional (feature degrades gracefully).

## Service Role Key Rules

- `SUPABASE_SERVICE_ROLE_KEY` must NEVER appear in any client-side `.env`
  file or bundled code.
- It belongs ONLY in Supabase Edge Function environment secrets.
- Client apps (rider, driver, admin) must use the anonymous/anon key only.
