#!/usr/bin/env bash
set -euo pipefail

url="${1:-}"
if [[ -z "$url" ]]; then
  echo "usage: $0 <health-url>" >&2
  exit 2
fi

status="$(curl --fail --silent --show-error --location \
  --connect-timeout 5 --max-time 15 \
  --output /tmp/g-taxi-health-response \
  --write-out '%{http_code}' "$url")"

if [[ "$status" != 2* ]]; then
  echo "health check failed: HTTP $status from $url" >&2
  cat /tmp/g-taxi-health-response >&2 || true
  exit 1
fi

echo "health check passed: HTTP $status from $url"