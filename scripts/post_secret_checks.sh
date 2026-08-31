#!/usr/bin/env bash
# Post-secret checks: run after setting secrets in Supabase Dashboard (recommended)
# Usage: chmod +x scripts/post_secret_checks.sh && ./scripts/post_secret_checks.sh

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

echo "1) Running secret verifier..."
node scripts/verify-secrets.js || true

echo "\n2) Running full verifier (may be slow)..."
if [ -f scripts/verify-all.js ]; then
  node scripts/verify-all.js || true
else
  echo "scripts/verify-all.js not found, skipping."
fi

# If supabase CLI is available, list functions and tail logs for critical ones
if command -v supabase >/dev/null 2>&1; then
  echo "\n3) Supabase CLI found — listing functions (may require login)..."
  supabase functions list || true

  CRITICAL_FUNCS=(stripe_webhook create_stripe_customer create_wipay_payment complete_ride)
  for fn in "${CRITICAL_FUNCS[@]}"; do
    echo "\n--- Last logs for function: $fn ---"
    supabase functions logs list "$fn" --limit 20 || echo "(logs unavailable for $fn)"
  done
else
  echo "\nSupabase CLI not found; skipping function list/logs. Install or run via Dashboard." 
fi

# Summary
echo "\nPost-secret checks complete. Inspect output above for missing keys or function errors."
