FROM python:3.11-slim

WORKDIR /app

# Install system deps for httpx
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Try to install AGY SDK — non-fatal if unavailable. Its own dependency
# chain (mcp, google-genai) pulls in a starlette major version (1.x)
# incompatible with the fastapi pin above (fastapi 0.111-0.119 requires
# starlette<0.49) -- confirmed live on Render 2026-09: AGY itself installed
# fine, but the upgraded starlette broke bare `FastAPI()` construction with
# "Router.__init__() got an unexpected keyword argument 'on_startup'",
# crashing the whole service before main.py's own AGY-unavailable fallback
# ever got a chance to matter. Re-pin starlette back down immediately after
# -- this app's own FastAPI/Starlette usage is what has to actually run;
# AGY is best-effort and already degrades gracefully in main.py if its
# import fails.
RUN pip install --no-cache-dir google-antigravity || echo "AGY SDK unavailable, using Groq fallback"
RUN pip install --no-cache-dir "starlette>=0.40.0,<0.49.0"

COPY . .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
