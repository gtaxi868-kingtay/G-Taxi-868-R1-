#!/usr/bin/env bash
set -euo pipefail

compose_file="$(cd "$(dirname "$0")" && pwd)/docker-compose.yml"
env_file="$(cd "$(dirname "$0")" && pwd)/.env"

if [[ ! -f "$env_file" ]]; then
  echo "missing $env_file; copy .env.example and configure both slots first" >&2
  exit 1
fi

current_blue="$(grep '^BLUE_UPSTREAM=' "$env_file" | cut -d= -f2- || true)"
current_green="$(grep '^GREEN_UPSTREAM=' "$env_file" | cut -d= -f2- || true)"

if [[ -z "$current_blue" || -z "$current_green" ]]; then
  echo "BLUE_UPSTREAM and GREEN_UPSTREAM must both be configured" >&2
  exit 1
fi

case "${1:-}" in
  blue)
    active="$current_blue"
    standby="$current_green"
    ;;
  green)
    active="$current_green"
    standby="$current_blue"
    ;;
  *)
    echo "usage: $0 blue|green" >&2
    exit 2
    ;;
esac

backup="$env_file.bak.$(date +%Y%m%d%H%M%S)"
cp "$env_file" "$backup"

sed -i '' "s|^BLUE_UPSTREAM=.*|BLUE_UPSTREAM=$active|" "$env_file"
sed -i '' "s|^GREEN_UPSTREAM=.*|GREEN_UPSTREAM=$standby|" "$env_file"

docker compose -f "$compose_file" --env-file "$env_file" config >/dev/null
docker compose -f "$compose_file" --env-file "$env_file" up -d --no-deps caddy

echo "promoted $1 upstream: $active"
echo "previous environment backed up at $backup"
