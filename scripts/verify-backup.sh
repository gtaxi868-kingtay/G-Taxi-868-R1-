#!/usr/bin/env bash
set -euo pipefail

backup_dir="${1:-}"
if [[ -z "$backup_dir" || ! -d "$backup_dir" ]]; then
  echo "usage: $0 <backup-directory>" >&2
  exit 2
fi

[[ -f "$backup_dir/supabase.dump" ]] || { echo "missing supabase.dump" >&2; exit 1; }
[[ -f "$backup_dir/SHA256SUMS" ]] || { echo "missing SHA256SUMS" >&2; exit 1; }

(cd "$backup_dir" && sha256sum --check SHA256SUMS)
command -v pg_restore >/dev/null || { echo "pg_restore is required" >&2; exit 2; }
pg_restore --list "$backup_dir/supabase.dump" >/dev/null

if [[ -f "$backup_dir/vps-config.tgz" ]]; then
  tar -tzf "$backup_dir/vps-config.tgz" >/dev/null
fi

echo "backup verification passed: $backup_dir"
