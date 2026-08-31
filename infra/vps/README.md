# VPS starter stack for G-Taxi

This directory is a minimal operational base for a small VPS before you scale into scraper, forecasting, or AI agent work.

## What is included

- Caddy for TLS and reverse proxy
- Uptime Kuma for uptime monitoring
- Redis for background queues and lightweight caching
- A minimal Python worker container that can be extended later
- A clean `.env` pattern for secrets

This is intentionally lean. It is not a large-scale AI platform yet; it is a stable foundation for operational work.

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
- Add Redis or worker jobs only when there is a real task to run.
- Add Prometheus/Grafana later if you actually need deeper system metrics.

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
