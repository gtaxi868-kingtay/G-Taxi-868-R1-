#!/usr/bin/env node

/**
 * Secret Verification Script
 * Validates that all required Supabase Edge Function secrets are present
 * in the environment. Designed for CI — warns on optional, fails on required.
 *
 * Exit codes:
 *   0 — all required secrets present
 *   1 — one or more required secrets missing
 */

const REQUIRED = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'FIREBASE_SERVICE_ACCOUNT_JSON',
];

const OPTIONAL = [
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_ACCESS_TOKEN',
  'WIPAY_API_KEY',
  'WIPAY_WEBHOOK_SECRET',
  'AMADEUS_API_KEY',
  'AMADEUS_API_SECRET',
  'BOOKING_API_KEY',
  'SENTRY_DSN',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
];

const COLORS = {
  PASS: '\x1b[32m\u2713\x1b[0m',
  FAIL: '\x1b[31m\u2717\x1b[0m',
  WARN: '\x1b[33m\u26a0\x1b[0m',
};

let exitCode = 0;

console.log('\n  Edge Function Secrets Verification\n');

for (const key of REQUIRED) {
  if (process.env[key]) {
    console.log(`  ${COLORS.PASS}  ${key}  [set]`);
  } else {
    console.log(`  ${COLORS.FAIL}  ${key}  [MISSING]`);
    exitCode = 1;
  }
}

for (const key of OPTIONAL) {
  if (process.env[key]) {
    console.log(`  ${COLORS.PASS}  ${key}  [set]`);
  } else {
    console.log(`  ${COLORS.WARN}  ${key}  [not set - feature degraded]`);
  }
}

console.log();
process.exit(exitCode);
