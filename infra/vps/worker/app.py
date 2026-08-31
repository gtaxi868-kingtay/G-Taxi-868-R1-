import os
import time
from typing import Optional

import requests
import redis


REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
TICK_SECONDS = int(os.getenv("WORKER_TICK_SECONDS", "60"))
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
DOMAIN = os.getenv("DOMAIN", "localhost")


def ping_health() -> None:
    try:
        requests.get("http://localhost:3001", timeout=5)
    except Exception:
        pass


def main() -> None:
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
