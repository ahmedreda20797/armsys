# ARM ERP — Python Analytics Service (Phase 5.2)

Production HTTP boundary that exposes the **existing, unmodified**
analytics engine (`python-analytics/employee_analytics.py`) to the
ARM Next.js deployment on **Vercel**. Vercel's Node serverless runtime
cannot rely on a local Python executable — so the production bridge
calls THIS service over HTTPS instead.

```
Browser → ARM Next.js (Vercel)
            requireAuth → verifyPermission('kpiReports','view')
            → employee scope validation
            → getEmployeePerformanceDataset()   ← verified dataset
            → HTTPS POST (Bearer PYTHON_ANALYTICS_API_KEY)
                 ↓
          THIS SERVICE  (app.py)
            auth → JSON validation → employee_analytics.build_result()
                 ↓
          EmployeeAnalyticsResult (Phase 5 JSON contract, verbatim)
```

Hard boundaries (unchanged from Phase 5):

- Python **never** accesses Firebase — the only input is the pushed
  dataset. Permissions, employee scope, KPI calculations and business
  logic stay inside the ARM application.
- The engine is imported and called **as-is** — no second analytics
  implementation. `python-service/employee_analytics.py` is a
  byte-identical copy of the canonical engine, enforced by a sync
  guard test.
- Failure isolation: if this service is offline, slow, or wrong, the
  Smart Quality Report still renders; only the analytics section
  degrades to an explicit state.

---

## Endpoints

### `GET /health`

No authentication, no secrets, no data:

```json
{ "status": "ok", "service": "python-analytics", "engineVersion": "1.0.0" }
```

### `POST /analyze/employee-performance`

Authentication: `Authorization: Bearer <PYTHON_ANALYTICS_API_KEY>`
(constant-time comparison; fail-closed if the service has no key
configured).

Request body (the same envelope the local bridge pipes over stdin):

```json
{ "schemaVersion": 1, "dataset": { "...EmployeePerformanceDataset..." } }
```

Response:

- `200` → the `EmployeeAnalyticsResult` JSON (Phase 5 contract,
  `schemaVersion: 1` — never silently changed).
- `400 ERROR_INVALID_DATASET` → envelope/dataset failed the engine's
  own fail-closed validator (schemaVersion, datasetKind, required
  fields). Malformed input is **rejected, never repaired**.
- `401 ERROR_UNAUTHORIZED` → missing/wrong bearer key.
- `413 ERROR_PAYLOAD_TOO_LARGE` → body exceeds the 10 MB cap
  (matches the Next.js bridge cap; datasets are small JSON).
- `429 ERROR_RATE_LIMITED` → basic per-client fixed-window abuse
  protection (default 120 req/min; the shared secret remains the
  primary boundary).
- `500` → `ERROR_SERVER_CONFIG` (no key configured) or
  `ERROR_INTERNAL` (engine crashed; logged structurally, no data).

Client error mapping (Next.js bridge, spec §10):

| Service verdict            | Bridge reason          | API status             |
| -------------------------- | ---------------------- | ---------------------- |
| unreachable (after 1 retry)| `PYTHON_UNAVAILABLE`   | `ANALYTICS_UNAVAILABLE`|
| timeout                    | `TIMEOUT`              | `ANALYTICS_TIMEOUT`    |
| HTTP 400                   | `DATA_CONTRACT_ERROR`  | `ANALYTICS_ERROR`      |
| HTTP 401/403               | `SERVICE_AUTH_ERROR`   | `ANALYTICS_ERROR`      |
| HTTP 429 / other / crash   | `SERVICE_ERROR`        | `ANALYTICS_ERROR`      |
| 200 + invalid schema       | `INVALID_OUTPUT`       | `ANALYTICS_ERROR`      |

`INSUFFICIENT_DATA` is **not** in this table: it is an analytical
result that lives inside a `200 OK` payload (per-method blocks) —
never a transport state.

---

## Configuration (service side)

| Variable                              | Default | Purpose                                |
| ------------------------------------- | ------- | -------------------------------------- |
| `PYTHON_ANALYTICS_API_KEY`            | —       | Required for `/analyze`. Fail-closed if unset. |
| `PYTHON_SERVICE_PORT`                 | `8080`  | Listen port                            |
| `PYTHON_SERVICE_RATE_LIMIT_PER_MINUTE`| `120`   | Per-client fixed-window limit (`0` = off) |

The service is **stdlib-only** (`requirements.txt` is intentionally
empty) — nothing to pip-install, small image, deterministic startup.

---

## Run locally

```bash
cd python-service
PYTHON_ANALYTICS_API_KEY=$(openssl rand -hex 32) python3 app.py
# another terminal — smoke test
curl -s http://127.0.0.1:8080/health
curl -s -X POST http://127.0.0.1:8080/analyze/employee-performance \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  --data '{"schemaVersion":1,"dataset":{}}'   # → 400 ERROR_INVALID_DATASET (fail-closed works)
```

## Docker

```bash
# from the repository root
docker build -t arm-python-analytics -f python-service/Dockerfile python-service
docker run -d -p 8080:8080 \
  -e PYTHON_ANALYTICS_API_KEY=<same value as Vercel> \
  arm-python-analytics
```

The image is `python:3.12-slim`, runs as a **non-root** user, installs
**zero** packages, and ships only `app.py` + the engine.

---

## ARM (Next.js / Vercel) side

Set on Vercel (Production + Preview):

| Variable                   | Value                                  |
| -------------------------- | -------------------------------------- |
| `PYTHON_ANALYTICS_MODE`    | `remote`                               |
| `PYTHON_ANALYTICS_URL`     | `https://<your-service-host>`          |
| `PYTHON_ANALYTICS_API_KEY` | same secret as the service             |
| `PYTHON_ANALYTICS_TIMEOUT_MS` | `45000` recommended (see cold starts) |

Local development keeps `PYTHON_ANALYTICS_MODE=local` (or unset) and
works exactly as in Phase 5. Both modes produce the **same output
contract**, and the deep response validation (spec §9) applies to both.

---

## Hosting recommendation (evaluated August 2026)

Requirement: $0 to start, HTTPS, env vars, Docker or native Python,
small RAM, tolerable cold starts. Current policy landscape —
**platforms have changed their free tiers, documented here so nobody
gets surprised**:

| Platform       | Free tier status (verified 2026-08)                                                                 | Verdict |
| -------------- | --------------------------------------------------------------------------------------------------- | ------- |
| **Render**     | ✅ 750 free instance hours/workspace/month, free web services spin down after 15 min idle; 2026 policy change: bandwidth capped (~5 GB/mo) | **Recommended — primary** |
| **Koyeb**      | ✅ One free web service (512 MB RAM / 0.1 vCPU / 2 GB SSD), no credit card; light-sleep wake is fast | **Recommended — alternative** |
| Hugging Face Spaces | ❌ **Changed July 2026**: Docker SDK moved to paid plans (free CPU Basic removed)              | Not viable |
| Fly.io         | ❌ Legacy free allowances replaced (2024) by a short trial; card required                            | Not free |
| Railway        | ❌ Permanent free tier removed (2024); one-time $5 trial credit only                                 | Not free |

### Deploying on Render (free)

1. Push the repository to GitHub (the service lives in
   `python-service/`, portable — no Render-specific code).
2. Render dashboard → **New → Web Service** → connect the repo.
3. Settings:
   - **Runtime**: Docker · **Dockerfile path**: `python-service/Dockerfile`
     (or Runtime: Python 3 · Build: nothing needed · Start:
     `python3 app.py` with Root Directory `python-service`)
   - **Environment**: `PYTHON_ANALYTICS_API_KEY=<secret>`
   - Health check path: `/health`
4. Deploy — Render gives you `https://<service>.onrender.com` (HTTPS).
5. Put the URL + the same secret into Vercel env vars (table above)
   and redeploy the ARM app.

### Cold starts (accepted, spec §23)

- A free Render service sleeps after ~15 minutes without traffic;
  the next request pays a ~30–60 s cold start **once**.
- The bridge handles this: strict server-side timeout
  (`PYTHON_ANALYTICS_TIMEOUT_MS=45000` covers a cold start while
  staying bounded), **one** short retry for transient connection
  failures only, and the Smart Quality Report renders the rest of
  the report regardless — the analytics section alone shows
  `ANALYTICS_UNAVAILABLE` / `ANALYTICS_TIMEOUT` with a retry button.
- Results are cached in the Next.js bridge (content-keyed), so
  repeat views of the same employee/period never pay the cost twice.
- Optional: a lightweight keep-alive ping (e.g. cron-job.org hitting
  `/health` every 10 min) keeps the service warm; 750 h/month covers
  one always-on service. This is optional infrastructure, not code.

### Portability

The service is provider-agnostic: any host that runs a Dockerfile or
a Python 3 process with env vars works (Render, Koyeb, a $4 VPS, a
company VM). No platform SDK, no vendor lock-in anywhere in the code.

---

## Tests

```bash
npm run test:python-service   # 24 tests: health, auth, validation,
                              # contract, partial MTD data (§42),
                              # rate limit, engine sync guard
```

The suite exercises the socket-free `dispatch()` core directly and
includes a **sync guard** that fails if the shipped engine ever
drifts from the canonical `python-analytics/employee_analytics.py`.
