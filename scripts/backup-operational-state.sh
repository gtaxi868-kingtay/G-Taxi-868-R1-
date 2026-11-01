#!/usr/bin/env bash
set -euo pipefail

backup_env="${BACKUP_ENVIRONMENT:-}"
if [[ "$backup_env" != "staging" && "$backup_env" != "production" ]]; then
  echo "BACKUP_ENVIRONMENT must be staging or production" >&2
  exit 2
fi

if [[ "$backup_env" == "production" && "${CONFIRM_PRODUCTION_BACKUP:-}" != "BACKUP_PRODUCTION" ]]; then
  echo "Production backup requires CONFIRM_PRODUCTION_BACKUP=BACKUP_PRODUCTION" >&2
  exit 2
fi

backup_dir="${BACKUP_DIR:-backups/$backup_env}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output_dir="$backup_dir/$timestamp"
mkdir -p "$output_dir"

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "SUPABASE_DB_URL is required and must come from a secret manager" >&2
  exit 2
fi

command -v pg_dump >/dev/null || { echo "pg_dump is required" >&2; exit 2; }

pg_dump \
  --dbname="$SUPABASE_DB_URL" \
  --format=custom \
  --no-owner \
  --file="$output_dir/supabase.dump"

if [[ -d infra/vps ]]; then
  tar \
    --exclude='infra/vps/.env' \
    --exclude='infra/vps/redis-data' \
    --exclude='infra/vps/uptime-kuma-data' \
    --exclude='infra/vps/caddy_data' \
    --exclude='infra/vps/caddy_config' \
    --exclude='infra/vps/worker/__pycache__' \
    -czf "$output_dir/vps-config.tgz" \
    infra/vps
fi

sha256sum "$output_dir"/* > "$output_dir/SHA256SUMS"
printf 'backup created: %s\n' "$output_dir"
printf 'secrets were not copied; store them separately in the secret manager\n'
