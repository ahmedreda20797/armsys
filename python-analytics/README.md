# ARM ERP — Python Analytics Engine (Phase 5)

> ⚠️ **PHASE 5.3 — MIGRATION / REFERENCE ONLY. NOT REQUIRED FOR ARM RUNTIME.**
>
> As of Phase 5.3 the CANONICAL production analytics engine is the
> TypeScript implementation in `src/lib/analytics/engine.ts` — it runs
> in-process and the application builds, deploys and runs WITHOUT
> Python. This directory is retained ONLY as the verified reference
> implementation used by the Python↔TypeScript parity tests
> (`src/lib/analytics/__tests__/python-parity.test.ts`) and its own
> unit tests (`npm run test:python-reference`).
>
> Do NOT wire this engine into the production request path again.


Deterministic **statistical and pattern analysis** over the verified
`EmployeePerformanceDataset` produced by the existing Performance
Intelligence layer (TypeScript). This is an **analytics layer only** —
it is never a KPI source of truth, never an evaluation authority, and
never a replacement for the TypeScript business logic.

```
Canonical DB → KPI Engine → Performance Intelligence dataset
    → python-analytics (this engine, analysis only)
    → Verified Analytical Results (structured JSON)
    → future AI Narrative Layer (NOT part of this phase)
```

## Architecture (spec §26 — chosen boundary: Python subprocess)

| Aspect | Decision |
|---|---|
| Invocation | `spawn(python3 -I employee_analytics.py)` from `src/lib/analytics/python-bridge.ts` |
| Input | JSON envelope on **stdin**: `{ schemaVersion: 1, dataset: <EmployeePerformanceDataset> }` |
| Output | JSON result on **stdout** (single line) — never prose |
| Dependencies | **Python standard library only** — zero pip packages, no venv needed |
| Failure mode | Bridge never throws; explicit `UNAVAILABLE`/`ERROR` states (HTTP 200) |
| Deployment | Docker runner image installs `python3` (`apk add --no-cache python3`); other platforms degrade gracefully |

### Why a subprocess?
The primary deployment is a single Docker container (Render `runtime: docker`).
A persistent Python service or a second container would add ports, auth and
orchestration that the platform does not need. A stdin→stdout subprocess is
the most portable boundary: identical behavior locally, in Docker, and (via a
future adapter) in a serverless endpoint — without changing the engine.

## Read-only guarantees (spec §4)

* The engine imports only `json`, `math`, `statistics`, `sys`, `datetime`.
* No network modules, no database drivers, no filesystem access, no subprocess.
* Tests enforce this structurally (Python `ReadOnlySourceContractTests` +
  TypeScript static scans).

## KPI integrity (spec §5)

The engine **never** recalculates Quality Score, Quality Weight, Weighted
Contribution or Company KPI. Engine outputs are echoed verbatim once, in
`kpiFactsEcho`, purely for traceability; a test proves the contribution value
appears exactly once in the whole result.

## Output contract (see `src/lib/analytics/types.ts` for the TS mirror)

| Block | Content | Spec |
|---|---|---|
| `trendAnalysis` | direction, slope (pp/month), mean, median, min/max/range, sample std-dev, CV, period-over-period deltas, explicit `INSUFFICIENT_DATA` | §7 |
| `patternAnalysis` | observation distributions + concentration, repeated-issue frequency %, recurrence interval, window spread | §8/§9 |
| `anomalies` | conservative count-spike + score-drop detection with expected range, severity, confidence | §10 |
| `distributionAnalysis` | complaints / CAPA / follow-ups / deals / attendance (context-only) | §12-§16 |
| `periodComparison` | current vs previous month counts + deltas | §6 |
| `crossDomainPatterns` | temporal co-increase associations (`ASSOCIATION_NOT_CAUSATION`) | §17 |
| `correlations` | Pearson r with n, strength, limitations — only at n ≥ 8 | §18 |
| `dataQuality` | missing data, insufficient samples, ambiguous relationships, unavailable metrics | §19 |
| `evidenceReferences` | consolidated `{collection, recordIds}` traceability | §20 |

## Statistical safety thresholds (spec §11 — documented, deterministic)

| Threshold | Value | Meaning |
|---|---|---|
| Trend statistics | ≥ 3 available months | below → explicit insufficient-data |
| Trend confidence | HIGH ≥ 6 months, MEDIUM 3–5 | |
| Anomaly baseline | ≥ 5 complete months | reported month excluded from baseline |
| Anomaly trigger | robust z ≥ 3 (median/MAD) | only ABOVE-baseline spikes |
| Score-drop trigger | Δ ≤ −10 pp vs previous available month | HIGH at ≤ −20 pp |
| Cross-domain pattern | ≥ 4 months and ≥ 2 shared increase months | |
| Correlation | ≥ 8 paired months | below → surfaced in `dataQuality.insufficientSamples` |
| Concentration | count ≥ 3 AND share ≥ 40 % | measurable fact, never an interpretation |
| MTD reported month | partial → anomaly/cross-domain/correlation **skipped** | raw MTD delta still reported as FACT |

Missing KPI months are **never** treated as zero. Record-count series treat a
window month with no stored records as 0 records (a stored fact) — this
convention is documented in `dataQuality.notes`.

## Confidence model (spec §23)

Per-analysis and overall: `HIGH | MEDIUM | LOW | INSUFFICIENT_DATA`,
produced by deterministic sample-size rules (overall = worst of the
analyses that ran).

## Running

```bash
# engine smoke test
echo '{"schemaVersion":1,"dataset":{...}}' | python3 python-analytics/employee_analytics.py

# Python unit tests (52 tests)
npm run test:python

# TypeScript bridge/route tests
npm test
```

## Environment variables (all optional)

| Variable | Default | Purpose |
|---|---|---|
| `PYTHON_ANALYTICS_ENABLED` | on | `0`/`false` disables the layer |
| `PYTHON_ANALYTICS_BIN` | auto-detect `python3`/`python` | explicit interpreter path |
| `PYTHON_ANALYTICS_SCRIPT` | `<cwd>/python-analytics/employee_analytics.py` | engine path override |
| `PYTHON_ANALYTICS_TIMEOUT_MS` | `20000` | subprocess timeout |
| `PYTHON_ANALYTICS_CACHE_TTL_MS` | `600000` (`0` = off) | result cache TTL |
| `PYTHON_ANALYTICS_CACHE_MAX` | `64` | LRU entry cap |

## Caching (spec §29)

Results are cached server-side (LRU) keyed by **SHA-256 of the exact
payload** — employeeId + period + the full dataset content. Any source-data
change produces a new key, so stale analytics can never be served; the TTL is
belt-and-braces for fast-moving MTD data. Failures are never cached.

## No AI (spec §33)

This phase contains **no** LLM calls, no prompt construction, no narrative
generation, and no recommendations. The structured output is designed so the
future AI layer can compose `Verified Facts + Python Analysis + Evidence
References + Confidence → AI Narrative` (spec §32).
