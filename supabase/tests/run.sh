#!/usr/bin/env bash
# Run the money-path regression harness.
#
#   supabase/tests/run.sh
#
# Requires DATABASE_URL (Supabase -> Project Settings -> Database ->
# Connection string). Use the SESSION pooler or a direct connection for
# this, not the transaction pooler on 6543 — the harness relies on a
# single explicit transaction and on temp tables, which transaction-mode
# pooling does not preserve across statements.
#
# Exits non-zero if any assertion fails, so it can gate a deploy:
#   supabase/tests/run.sh && supabase functions deploy complete_ride
#
# Safe against production: the harness ends in ROLLBACK and persists
# nothing. It runs against REAL rows on purpose — that is what catches
# schema drift a typechecker cannot see.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set." >&2
  echo "Set it to a session-mode or direct Postgres connection string." >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found. Install the postgresql client, or paste" >&2
  echo "supabase/tests/money_paths.sql into the Supabase SQL editor." >&2
  exit 2
fi

echo "Running money-path harness (read-only: ends in ROLLBACK)..."
output="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$HERE/money_paths.sql" 2>&1)"
echo "$output"

# The harness prints a verdict row; trust that rather than psql's exit
# code, which is 0 even when assertions record FAIL.
if grep -q "DO NOT SHIP" <<<"$output"; then
  echo ""
  echo "FAILED — see the FAIL rows above." >&2
  exit 1
fi

if ! grep -q "ALL GREEN" <<<"$output"; then
  echo ""
  echo "Could not find a verdict row — harness did not finish." >&2
  exit 1
fi

echo ""
echo "ALL GREEN"
