# ══════════════════════════════════════════════════════════════
#  ARM ERP — Python Analytics Service (Phase 5.2)
#
#  Production image for the remote analytics runtime consumed by
#  the ARM Next.js deployment on Vercel (spec §16).
#
#  Design goals:
#    • small image ............ python:3.12-slim, ZERO pip installs
#    • non-root runtime ....... dedicated unprivileged user
#    • health endpoint ........ GET /health (used by HEALTHCHECK)
#    • deterministic startup .. no build steps, no network access,
#                               fixed port from env
#
#  Build (from the repository root):
#    docker build -t arm-python-analytics -f python-service/Dockerfile python-service
#
#  Run:
#    docker run -d -p 8080:8080 \
#      -e PYTHON_ANALYTICS_API_KEY=<same value as Vercel> \
#      arm-python-analytics
# ══════════════════════════════════════════════════════════════

FROM python:3.12-slim

# No runtime OS packages are needed — the service is stdlib-only.
# (Base image stays as-is; apt lists are dropped to keep the layer small.)

WORKDIR /app

# Copy ONLY the service boundary + the canonical engine. No tests,
# no docs, no other project files enter the image.
COPY app.py employee_analytics.py ./

# Non-root runtime (spec §16): dedicated unprivileged user owning
# nothing but its own /app files.
RUN useradd --no-create-home --shell /usr/sbin/nologin analytics \
    && chown -R analytics:analytics /app
USER analytics

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHON_SERVICE_PORT=8080

EXPOSE 8080

# Deterministic startup: stdlib server on a fixed port, no
# migrations, no side effects. Fail-closed if the API key is unset
# (the service starts, but /analyze rejects every request until the
# operator configures PYTHON_ANALYTICS_API_KEY).
CMD ["python3", "app.py"]

# Container-level health probe against the public health endpoint
# (no secrets exposed — /health returns only status/service/version).
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["python3", "-c", "import json,sys,urllib.request; r=urllib.request.urlopen('http://127.0.0.1:'+__import__('os').environ.get('PYTHON_SERVICE_PORT','8080')+'/health', timeout=4); sys.exit(0 if json.load(r).get('status')=='ok' else 1)"]
