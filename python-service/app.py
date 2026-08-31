#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ARM ERP — Production Python Analytics Service (Phase 5.2)
=========================================================

A small, independent HTTP boundary that exposes the EXISTING
analytics engine (employee_analytics.py) to the ARM Next.js
production deployment on Vercel.

ARCHITECTURE (Phase 5.2 spec §2/§4/§7):

    Vercel (ARM Next.js)
      → requireAuth → verifyPermission('kpiReports','view')
      → employee scope validation
      → getEmployeePerformanceDataset()   [VERIFIED dataset]
      → HTTPS POST (Bearer PYTHON_ANALYTICS_API_KEY)
          ↓
    THIS SERVICE
      → authentication (shared secret)
      → JSON validation (fail-closed, no silent repair)
      → employee_analytics.build_result()   [UNTOUCHED engine]
          ↓
    Structured Analytics Result (Phase 5 JSON contract, verbatim)

HARD BOUNDARY RULES (spec §2/§3/§19):
  • Python NEVER accesses Firebase. The only input is the HTTPS
    body — an already-authorized dataset pushed IN by Next.js.
  • The engine is imported and called AS-IS. No algorithm is
    rewritten, no KPI is recalculated, no second implementation.
  • The service holds NO state about employees. Nothing is written
    anywhere — request in, JSON out.

SECURITY (spec §6/§19/§20):
  • Server-to-server Bearer auth — PYTHON_ANALYTICS_API_KEY,
    compared in constant time. The browser can never reach this
    service and never sees the key (only Next.js server holds it).
  • Fail-closed: if the service has no key configured, /analyze
    rejects everything with a structured error.
  • Request body capped (10 MB, matching the Next.js bridge cap).
  • Basic per-client fixed-window rate limiting (default 120
    req/min, env-tunable, 0 disables) — simple abuse protection;
    the shared secret remains the primary boundary (spec §20).
  • Logging is STRUCTURAL ONLY: method, path, status, duration,
    error code. NEVER the API key, NEVER the dataset, NEVER
    employee/customer content (spec §19/§27).

ZERO DEPENDENCIES: Python standard library only (spec §16/§47 —
small image, deterministic startup, nothing to pip-install).

ENDPOINTS (spec §5/§24):
  GET  /health                      → {"status": "ok", ...}
  POST /analyze/employee-performance → EmployeeAnalyticsResult

The request-handling core (`dispatch`) is socket-free and directly
unit-testable (tests/test_service.py).
"""

import hmac
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Make the colocated engine importable no matter the CWD.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import employee_analytics as engine  # noqa: E402  (canonical engine — UNMODIFIED)

SERVICE_NAME = "python-analytics"

ANALYZE_PATH = "/analyze/employee-performance"
HEALTH_PATH = "/health"

# Matches the Next.js bridge output cap (Phase 5) — datasets are small
# JSON payloads (spec §22); no compression, no streaming.
MAX_BODY_BYTES = 10 * 1024 * 1024

DEFAULT_RATE_LIMIT_PER_MINUTE = 120
RATE_WINDOW_SECONDS = 60.0
_MAX_RATE_KEYS = 8_192  # bounded memory even under address spoofing


# ══════════════════════════════════════════════════════════════
#  Safe structured logging (spec §27)
# ══════════════════════════════════════════════════════════════

def log_event(event, **fields):
    """One JSON line per event. Callers pass STRUCTURAL fields only."""
    try:
        payload = {"event": event, "ts": round(time.time(), 3)}
        payload.update(fields)
        sys.stdout.write(json.dumps(payload, ensure_ascii=True) + "\n")
        sys.stdout.flush()
    except Exception:
        # Logging must never break the service.
        pass


# ══════════════════════════════════════════════════════════════
#  Rate limiting (spec §20 — basic, bounded, optional)
# ══════════════════════════════════════════════════════════════

class FixedWindowRateLimiter:
    """Fixed-window per-client counter. Bounded memory; thread-safe
    enough for CPython (GIL) — worst case a rare lost increment."""

    def __init__(self, limit_per_minute):
        self.limit = limit_per_minute
        self._buckets = {}  # key -> [window_start, count]

    def allow(self, key, now=None):
        if self.limit <= 0:
            return True
        now = time.time() if now is None else now
        window_start = now - (now % RATE_WINDOW_SECONDS)
        bucket = self._buckets.get(key)
        if bucket is None or bucket[0] != window_start:
            if len(self._buckets) >= _MAX_RATE_KEYS:
                # Evict expired windows first; if still full, refuse
                # to grow (fail-closed for NEW keys only).
                cutoff = window_start
                self._buckets = {
                    k: b for k, b in self._buckets.items() if b[0] >= cutoff
                }
                if len(self._buckets) >= _MAX_RATE_KEYS:
                    return False
            self._buckets[key] = [window_start, 1]
            return True
        bucket[1] += 1
        return bucket[1] <= self.limit


# ══════════════════════════════════════════════════════════════
#  Error payloads (spec §8 — structured errors, no silent repair)
# ══════════════════════════════════════════════════════════════

def _error(status, code, message):
    return status, {"status": "ERROR", "error": {"code": code, "message": message}}


# ══════════════════════════════════════════════════════════════
#  Socket-free request core (directly unit-testable)
# ══════════════════════════════════════════════════════════════

def dispatch(method, path, headers, body_bytes, rate_limiter=None,
            client_key="local", env=None):
    """Handle one HTTP request. Returns (status, payload_dict).

    Pure function of its arguments: no socket, no globals mutation
    besides the optional rate limiter. `env` overrides os.environ
    for tests.
    """
    env = os.environ if env is None else env
    started = time.time()

    # ── Routing ───────────────────────────────────────────────
    if path == HEALTH_PATH:
        if method != "GET":
            return _error(405, "ERROR_METHOD_NOT_ALLOWED", "Use GET for /health.")
        # No secrets, no env values, no data (spec §5/§24).
        return 200, {
            "status": "ok",
            "service": SERVICE_NAME,
            "engineVersion": engine.ENGINE_VERSION,
        }

    if path == ANALYZE_PATH:
        if method != "POST":
            return _error(405, "ERROR_METHOD_NOT_ALLOWED",
                          "Use POST for %s." % ANALYZE_PATH)

        # ── Basic abuse protection (spec §20) ─────────────────
        if rate_limiter is not None and not rate_limiter.allow(client_key):
            return _error(429, "ERROR_RATE_LIMITED",
                          "Too many requests — retry later.")

        # ── Server-to-server authentication (spec §6) ─────────
        expected_key = (env.get("PYTHON_ANALYTICS_API_KEY") or "").strip()
        if not expected_key:
            # Fail-closed: a service without a configured secret must
            # never analyze anything (spec §19).
            log_event("auth_rejected", reason="service_key_not_configured")
            return _error(500, "ERROR_SERVER_CONFIG",
                          "Service authentication is not configured.")
        auth_header = headers.get("Authorization") or headers.get("authorization") or ""
        provided = auth_header[7:].strip() if auth_header.startswith("Bearer ") else ""
        if not provided or not hmac.compare_digest(provided, expected_key):
            log_event("auth_rejected", reason="bad_or_missing_credentials")
            return _error(401, "ERROR_UNAUTHORIZED",
                          "Valid bearer authentication is required.")

        # ── Body size cap (spec §22) ──────────────────────────
        try:
            content_length = int(headers.get("Content-Length") or 0)
        except (TypeError, ValueError):
            content_length = 0
        if content_length <= 0:
            return _error(400, "ERROR_MALFORMED_JSON", "Request body is required.")
        if content_length > MAX_BODY_BYTES:
            return _error(413, "ERROR_PAYLOAD_TOO_LARGE",
                          "Request body exceeds the %d byte cap." % MAX_BODY_BYTES)

        # ── JSON parsing (spec §8 — reject, never repair) ─────
        try:
            envelope = json.loads(body_bytes.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            return _error(400, "ERROR_MALFORMED_JSON",
                          "Request body is not valid JSON: %s" % exc)

        # ── Dataset contract (spec §8) — the UNMODIFIED engine
        #    validator is the single source of truth for the input
        #    contract (schemaVersion, datasetKind, required fields).
        dataset, validation_error = engine._validate_envelope(envelope)
        if validation_error is not None:
            return _error(400, "ERROR_INVALID_DATASET",
                          "%s: %s" % (validation_error.get("code"),
                                      validation_error.get("message")))

        # ── Analysis — canonical engine, called as-is (spec §3) ─
        try:
            result = engine.build_result(dataset)
        except Exception as exc:  # engine crash = service error
            log_event("engine_failed", error_class=type(exc).__name__)
            return _error(500, "ERROR_INTERNAL",
                          "Analytics execution failed.")

        log_event("analyze_ok", duration_ms=round((time.time() - started) * 1000, 1),
                  resultStatus=result.get("status"),
                  overallConfidence=result.get("overallConfidence"))
        return 200, result

    return _error(404, "ERROR_NOT_FOUND", "Unknown endpoint.")


# ══════════════════════════════════════════════════════════════
#  HTTP wiring (thin socket shell around `dispatch`)
# ══════════════════════════════════════════════════════════════

def _env_int(name, default):
    try:
        return int((os.environ.get(name) or "").strip() or default)
    except (TypeError, ValueError):
        return default


_rate_limiter = FixedWindowRateLimiter(_env_int("PYTHON_SERVICE_RATE_LIMIT_PER_MINUTE",
                                                DEFAULT_RATE_LIMIT_PER_MINUTE))


class AnalyticsRequestHandler(BaseHTTPRequestHandler):
    server_version = "arm-python-analytics/1.0"
    protocol_version = "HTTP/1.1"
    timeout = 30  # socket read timeout — never hang a connection

    def _client_key(self):
        forwarded = self.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return self.client_address[0] if self.client_address else "unknown"

    def _respond(self, status, payload):
        body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle(self, method):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except (TypeError, ValueError):
            length = 0
        body = self.rfile.read(length) if length > 0 else b""
        started = time.time()
        status, payload = dispatch(
            method, self.path, self.headers, body,
            rate_limiter=_rate_limiter, client_key=self._client_key(),
        )
        self._respond(status, payload)
        # Structural observability only — never body/auth content.
        log_event("request", method=method, path=self.path,
                  status=status,
                  duration_ms=round((time.time() - started) * 1000, 1))

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")

    def log_message(self, fmt, *args):
        # Silence the default per-line stderr access log — structured
        # events above are the observable trail (spec §27).
        return


def main():
    port = _env_int("PYTHON_SERVICE_PORT", 8080)
    if (os.environ.get("PYTHON_ANALYTICS_API_KEY") or "").strip() == "":
        # Startup warning only — requests are rejected fail-closed.
        log_event("startup_warning",
                  detail="PYTHON_ANALYTICS_API_KEY is not set; /analyze will reject all requests.")
    server = ThreadingHTTPServer(("0.0.0.0", port), AnalyticsRequestHandler)
    server.daemon_threads = True
    log_event("startup", service=SERVICE_NAME, port=port,
              engineVersion=engine.ENGINE_VERSION)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
