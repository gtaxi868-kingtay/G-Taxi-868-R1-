FROM python:3.11-slim

WORKDIR /app

# Install system deps for httpx
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Try to install AGY SDK — non-fatal if unavailable
RUN pip install --no-cache-dir google-antigravity || echo "AGY SDK unavailable, using Groq fallback"

COPY . .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
