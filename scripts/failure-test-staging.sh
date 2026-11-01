#!/usr/bin/env bash
set -euo pipefail

confirmation="${1:-}"
if [[ "$confirmation" != "FAILURE_TEST_STAGING" ]]; then
  echo "Refusing failure test. Run: $0 FAILURE_TEST_STAGING" >&2
  exit 2
fi

base_url="${STAGING_HEALTH_URL:-}"
if [[ -z "$base_url" ]]; then
  echo "STAGING_HEALTH_URL must point to a staging worker /ready endpoint" >&2
  exit 2
fi

if [[ "${DEPLOYMENT_ENVIRONMENT:-}" != "staging" ]]; then
  echo "DEPLOYMENT_ENVIRONMENT=staging is required" >&2
  exit 2
fi

compose_file="${COMPOSE_FILE:-infra/vps/docker-compose.yml}"
compose_project="${COMPOSE_PROJECT_NAME:-g-taxi-staging}"

check_ready() {
  curl --fail --silent --show-error --max-time 10 "$base_url" >/dev/null
}

restore_blue() {
  docker compose -p "$compose_project" -f "$compose_file" start worker-blue >/dev/null
}

trap restore_blue EXIT

echo "Checking staging readiness before the test..."
check_ready

echo "Stopping blue staging slot to test Caddy failover..."
docker compose -p "$compose_project" -f "$compose_file" stop worker-blue >/dev/null

for attempt in {1..12}; do
  if check_ready; then
    echo "failover passed: staging remained ready while blue was stopped"
    break
  fi
  if [[ "$attempt" == "12" ]]; then
    echo "failover failed: staging did not become ready on green" >&2
    exit 1
  fi
  sleep 5
done

echo "Restoring blue staging slot..."
restore_blue

for attempt in {1..12}; do
  if check_ready; then
    echo "recovery passed: staging is ready after blue restoration"
    exit 0
  fi
  if [[ "$attempt" == "12" ]]; then
    echo "recovery failed: staging did not become ready after restoration" >&2
    exit 1
  fi
  sleep 5
done