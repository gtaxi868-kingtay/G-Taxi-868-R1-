# VPS operational stack for G-Taxi

This directory is an operational base for worker services, monitoring, and controlled HTTP release slots. It is not the hosting layer for Supabase Edge Functions or the mobile apps.

## What is included

- Caddy for TLS and reverse proxy
- Caddy blue/green upstream routing under `/ops/*`
- Uptime Kuma for uptime monitoring
- Redis for background queues and lightweight caching
- A minimal Python worker container that can be extended later
- Jarvis (`../../services/jarvis`), the rider AI concierge, reverse-proxied at `/jarvis/*`
- A clean `.env` pattern for secrets

This is intentionally lean. It is not a large-scale AI platform yet; it is a stable foundation for operational work.

## Wiring up Jarvis once this stack is running

1. Set `JARVIS_SECRET` and `GROQ_API_KEY` in `.env` (see `.env.example`).
2. `sudo docker compose up -d --build` — this now also builds and starts the `jarvis` container.
3. In Supabase edge function secrets, set:
   - `JARVIS_SERVICE_URL=https://your-domain.com/jarvis/concierge`
   - `JARVIS_SECRET=` (same value as in this stack's `.env`)
4. Redeploy `ai_concierge_proactive` (`supabase functions deploy ai_concierge_proactive`) so it picks up the new env vars — Supabase edge functions read secrets at cold start, not per-request.
5. Confirm with `curl https://your-domain.com/jarvis/health` — should return `{"status":"healthy",...}`.

## Prerequisites

- Ubuntu 24.04 LTS server
- Docker Engine
- Docker Compose plugin

## Install Docker on Ubuntu

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
newgrp docker
```

## Set up the stack

From this directory:

```bash
cp .env.example .env
# edit .env with your actual domain and secrets
sudo docker compose up -d --build
```

## Blue/green release slots

The `worker-blue` and `worker-green` services are optional release slots. Start
them with:

```bash
sudo docker compose --profile release-slots up -d --build worker-blue worker-green caddy
```

Caddy balances `/ops/*` between `BLUE_UPSTREAM` and `GREEN_UPSTREAM`, performs
health checks at `/health`, and uses `lb_policy first` so only the first healthy
slot receives traffic. To promote green, set `BLUE_UPSTREAM` to the green
service (or swap the two values), then recreate Caddy:

```bash
sudo docker compose up -d --no-deps caddy
```

Or use the helper, which creates a timestamped `.env` backup:

```bash
./promote-slot.sh green
```

This only applies to HTTP services hosted on this VPS. Supabase Edge Functions
are promoted through the GitHub workflows in `.github/workflows/`; they are not
behind this Caddy instance.

## Useful access points

- Caddy: `https://your-domain.com`
- Uptime Kuma: `https://status.your-domain.com` or `http://server-ip:3001`
- Worker logs:

```bash
sudo docker compose logs -f worker
```

## Notes

- Keep Supabase as the main data and auth layer.
- Keep this VPS for operational/background tasks, not for user-facing business logic at first.
- Do not expose Redis, Uptime Kuma admin, or service-role credentials publicly.
- Add a second VPS or managed service before treating this as high availability.
- Add Prometheus/Grafana when deeper capacity metrics are required.

## Recommended next use cases

1. GPS batch relay
2. alert/monitoring worker
3. scheduled public-data fetchers
4. queue-based background tasks

## Security

- Use a real domain and valid DNS
- Keep secrets in `.env` and never commit them
- Use a firewall and fail2ban on the host
- Do not expose raw DB credentials or service-role keys in the VPS app layer
- Restrict `/ops/*` to an authenticated gateway before exposing any non-health endpoint
