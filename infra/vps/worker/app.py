import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from typing import Optional

import requests
import redis


REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
TICK_SECONDS = int(os.getenv("WORKER_TICK_SECONDS", "60"))
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
DOMAIN = os.getenv("DOMAIN", "localhost")
HTTP_PORT = int(os.getenv("HTTP_PORT", "8080"))


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path not in ("/health", "/ready"):
            self.send_response(404)
            self.end_headers()
            return

        status = 200 if self.path == "/health" else readiness_status()
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(("ok\n" if status == 200 else "not ready\n").encode())

    def log_message(self, _format: str, *_args: object) -> None:
        return


def serve_health() -> None:
    ThreadingHTTPServer(("0.0.0.0", HTTP_PORT), HealthHandler).serve_forever()


def readiness_status() -> int:
    try:
        client = redis.Redis.from_url(REDIS_URL, decode_responses=True, socket_timeout=2)
        if client.ping():
            return 200
    except Exception:
        pass
    return 503


def ping_health() -> None:
    try:
        requests.get("http://localhost:3001", timeout=5)
    except Exception:
        pass


def main() -> None:
    Thread(target=serve_health, daemon=True).start()
    r = redis.Redis.from_url(REDIS_URL, decode_responses=True)
    while True:
        try:
            # Minimal heartbeat and future-extension hook.
            r.set("g-taxi:worker:heartbeat", str(int(time.time())), ex=300)
            if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
                # Stub call to show the container is wired for future server-side jobs.
                pass
            ping_health()
        except Exception:
            pass
        time.sleep(TICK_SECONDS)


if __name__ == "__main__":
    main()
