# ARM ERP — Phase 2: Enterprise Attendance & Policy Engine
## Milestone 4 Completion Report — Time-Scoped Metrics & Employee Performance History Contract

**Date:** 2026-08-16
**Predecessors:** `docs/PHASE2-MILESTONE1-ATTENDANCE-AUDIT.md`, `docs/PHASE2-MILESTONE2-COMPLETION-REPORT.md`, `docs/PHASE2-MILESTONE3-COMPLETION-REPORT.md`

---

## §1 What This Milestone Is

A **contract / domain-model milestone**, not a feature milestone. Before any additional consumer switches to the canonical attendance layer or an Attendance KPI is implemented, ARM ERP now has a single, shared, typed time-scope vocabulary and an explicit current-vs-history performance contract.

The locked system-wide rule, now encoded in code and tests:

> **Current-period metrics reset with the new period; historical results are never erased. Every metric must have an explicit time scope.**

Nothing was migrated and no calculation was rewritten: the contract is purely additive (one new shared module + tests). Consumers adopt it in later, explicitly approved milestones.

## §2 Files Created

| File | Purpose |
|---|---|
| `src/lib/time-scope/index.ts` | The shared, domain-agnostic time-scope + performance-history contract (§3–§8 below) |
| `src/lib/time-scope/__tests__/time-scope.test.ts` | 30 focused tests covering every §21 requirement |
| `docs/PHASE2-MILESTONE4-COMPLETION-REPORT.md` | This report |

## §3 Files Modified

**None.** The milestone is purely additive. Untouched per the hard scope lock: the canonical attendance engine and `attendanceResults` storage (M2/M3), the Quality KPI engine (`kpiMetrics.ts`), `monthSnapshots` close/reopen lifecycle, Employee 360 route/page, KPI dashboard service, report routes, HR domain, requests workflow, dashboards. No consumer was migrated.

## §4 Time-Scope Contract

### 4.1 The vocabulary (`src/lib/time-scope/index.ts`)

`TimeScope` is a discriminated union over `TimeScopeKind`:

| Kind | Payload | Extent decided by |
|---|---|---|
| `day` | `date: YYYY-MM-DD` | calendar |
| `current_month` | — | calendar |
| `selected_month` | `monthKey: YYYY-MM` | calendar |
| `previous_month` | — | calendar |
| `last_3_months` | — | calendar |
| `last_6_months` | — | calendar |
| `current_year` | — | calendar |
| `custom_range` | `monthKeys: YYYY-MM[]` | explicit list |
| `career` | — | **data** (stored history) |

Key semantics:

- `resolveTimeScopeMonthKeys(scope, now)` returns month keys most-recent-first (the established project convention) for all calendar scopes; for `day` it returns the **containing month** (month-keyed stores are the storage granularity; day-level filtering stays a consumer concern). It **throws** on malformed `selected_month`/`custom_range`/`day` payloads (strict-contract convention, mirroring `month-utils`/engine strictness).
- `career` returns **`null`**, never month keys. Career scope is data-bound: it resolves to "every stored historical month", which only a history store can answer. This makes it structurally impossible to fabricate a career scope from calendar arithmetic — history grows, it is never inferred from the clock.
- Key helpers: `toMonthKey(date)` (replaces the inline `${y}-${pad(m+1)}` duplication pattern), `isValidDayKey` (real-calendar validation incl. leap years), `dayKeyToMonthKey`.
- Labeling contract (§8/§10/§11 of the milestone spec): `TIME_SCOPE_LABELS_AR` gives every kind an Arabic label — lifelong/all-time counters may only be displayed under `career` ("المسار الوظيفي (كل الفترات)"), never as an unlabeled current-period number. `describeTimeScope(scope)` produces canonical machine-readable identifiers (`day:2026-08-16`, `selected_month:2026-03`, `career:all-time`, …) that reports/logs can carry so a mixed scope is always visible.

### 4.2 Reuse — what was adopted vs created

| Existing abstraction | Status |
|---|---|
| `KpiRangePreset` (`src/types/quality-kpi.ts`) | **Reused verbatim.** The five shared calendar preset strings (`current_month`, `previous_month`, `last_3_months`, `last_6_months`, `current_year`) are the same identifiers in `TimeScopeKind`. The Quality strings remain defined exactly once. |
| `resolveMonthsInRange` (`src/lib/metrics/kpiMetrics.ts`) | **Semantics pinned by a parity test.** `resolveTimeScopeMonthKeys` keeps the calendar arithmetic local (~15 lines) rather than importing the Quality KPI engine (which transitively pulls `lib/audit` + `kpi-scoring`), and a parity test asserts identical output across all five presets × five dates (incl. year rollovers). The two can never drift. |
| `isValidMonthKey` (`src/lib/month-utils.ts`) | **Reused directly** for all month-key validation. |
| `computeTrend` / `TrendDirection` (Quality engine) | **Trend stays owned by Quality.** The career view deliberately computes no direction (§15): no new trend algorithm exists in this milestone. |
| YYYY-MM month identity + most-recent-first ordering | **Reused as conventions** throughout the new module. |

**Duplicate concepts identified during inspection (documented, not refactored):** inline month-key formatting in `employee-360/[id]/route.ts`, `date-utils.ts generateMonthOptions`, and the month-wide vs employee-month distinction between Quality `monthSnapshots` (month-keyed) and Attendance `attendanceResults` (month+employee-keyed). `toMonthKey` + the layering helpers are the canonical replacement path for future consumers.

### 4.3 `KpiRangePreset` interop

`kpiPresetToTimeScope(preset, customMonths?)` is the **single bridge** from the existing Quality preset vocabulary (including its comma-separated `customMonths` query-string convention) into `TimeScope`. Future consumers that receive a preset translate here instead of re-deriving range semantics; unknown presets fall back to `current_month` (matching `resolveMonthsInRange`'s defensive default).

## §5 Metric Context & Future Contracts

- **`MetricResult<TValue>`** (§5 of the spec): `{ metricId, employeeId, period, scope, value, calculationVersion, source, department? }`. A contract for **future consumers only** — no existing record was migrated into this shape. `MetricSource` distinguishes `quality | attendance | hr | sales | final-kpi` (open union). **HR remains explicitly attributable** (§18): HR deductions are never absorbed into Attendance or Quality metrics; they may only become their own PerformanceFactor later.
- **`MonthlyPerformanceResult`** (§13): the reserved future monthly performance snapshot — `employeeId`, `month`, `qualityFactor`, `attendanceFactor`, `salesFactor`, `hrFactor`, `finalScore`, `weightsSnapshot`, `calculationVersion`, `generatedAt`. Type reservation only; nothing constructs it; the Unified Performance Engine remains unimplemented.

## §6 Monthly Snapshot Contract — Confirmed, Unchanged

The principle "monthly results are stored independently per month" is now contractual:

- **Quality:** `monthSnapshots` per month (id = month key) — untouched.
- **Attendance:** `attendanceResults` per `month + employeeId` (deterministic id `${month}_${employeeId}`) — untouched (§19 of the spec: no storage-model change; the M3 identity remains canonical). `StoredAttendanceResult` **structurally satisfies** the new `MonthScopedResult` base (`employeeId` + `month`) — proven by test, so attendance needs no adapter.
- **Future Sales / HR monthly results** must mirror the same `MonthScopedResult` identity (documented in the contract as the binding pattern).

## §7 Current vs History vs Career — Employee 360 Layers

`buildEmployeePerformanceLayers({ records, currentMonthKey, extractValue })` is a **pure** function giving one employee the three explicit layers:

| Layer | Content | Guarantee |
|---|---|---|
| A — `current` | the stored result for the current month only, or `null` | A new month starts a new scope; values are **never carried forward**. A missing current month yields `null` — history is never promoted into it. |
| B — `history` | every stored result for strictly earlier months, most-recent-first | Records are never deleted or mutated by the passage of time. |
| C — `career` | `CareerSummary` derived from **all** stored monthly results: `sampleSize`, first/last month, `bestMonth`, `worstMonth`, `averageValue` (rounded, `computeTrend` convention), chronological `monthOverMonthDeltas` | Derived view only — never overwrites a monthly record. Deltas are empty below two results: a career delta can never come from a single current score. Ties resolve to the most recent month (deterministic). |

Supporting pure helpers: `buildMonthlyHistoryIndex` (per-employee × per-month map; duplicate employee+month follows M3 regeneration semantics — last wins, never duplicated) and `selectMonths` (ordered month selection for `selected_month`/`previous_month`/rolling-window views).

**Employee 360 implications (documented, not yet applied — full redesign is out of scope):** today `GET /api/employee-360/[id]` mixes scopes silently (attendance/quality/HR filtered to the current month, while follow-ups/travel/complaints/CAPA/risk are all-time, all under one unlabeled `stats` payload). The contract gives the future migration its target shape: current-month cards labeled `الشهر الحالي`, a monthly history list, a career view labeled `المسار الوظيفي (كل الفترات)` for anything all-time, and HR deductions displayed as their own attributable domain per month.

## §8 Dashboard / Report Implications

- Every dashboard request carries an explicit scope; every returned metric belongs to that scope. Mixed-scope cards must label each value with its scope (machine-checkable via `describeTimeScope`).
- Reports identify as Today / Current Month / Selected Month / Selected Range / YTD / Career. The `career` label is the only legal home for all-time numbers.
- The future KPI system stays monthly/time-scoped (Quality/Attendance/Sales/Final KPI per month; month-end results become historical records — never a forever-growing score).

## §9 Tests (30, all passing)

`src/lib/time-scope/__tests__/time-scope.test.ts` — pure primitives only (project convention: no Firebase mocking). Coverage per spec §21:

- **Time scope:** every kind resolves correctly (current/selected/previous month, `last_3_months`/`last_6_months` incl. year rollover, `current_year` incl. January single-month, `custom_range` validation + order preservation, `day` strict validation incl. leap years, `career → null`), `isCalendarScope`/`isHistoricalAggregateScope`, `toMonthKey`, labels completeness, `describeTimeScope`, `kpiPresetToTimeScope` (incl. query-string + fallback), and the **parity test** against `resolveMonthsInRange`.
- **Monthly reset:** engine-level (September's calculation contains only September values — no late/absence/deduction carry-over from August) and layer-level (month flip → `current` is the new month's own result).
- **Historical retention:** August remains available and unchanged after September exists (deterministic identity, September write plan never touches August's id, history index + layers retrieve August intact); missing current month → `null` current, never a promoted historical value.
- **Employee 360 semantics:** current = current result, historical month = historical result, career derived from **multiple** historical results (best/worst/average/deltas; single record → no deltas; empty → explicit nulls), regeneration last-wins, deterministic ties, strict validation.
- **Data isolation:** engine-level (two employees, same month — no counter leakage), identity separation, per-employee history index and layers, independent write plans.
- **Future contracts:** `MetricResult` and `MonthlyPerformanceResult` constructible in documented shape (HR source distinct); `StoredAttendanceResult` structurally satisfies `MonthScopedResult`.

## §10 Verification Results

| Gate | Result |
|---|---|
| `npx tsx --test src/lib/time-scope/__tests__/time-scope.test.ts` | **30/30 pass** |
| `npx tsc --noEmit` | 19 errors — **all pre-existing** in unrelated files (`EmployeeQualityKpiPanel.tsx`, `kpi-dashboard/__tests__`, `riskMetrics.test.ts`, `quality-migration/index.ts`, `src/workflow/*`); **0 errors** in `src/lib/time-scope/**`. Baseline unchanged (this milestone modified no existing file). |
| `npm run lint` | Project-wide baseline unchanged (11,854 pre-existing problems in unrelated files). `npx eslint src/lib/time-scope/` → **0 problems**. |
| `npm test` | **506/507 pass.** The single failure is pre-existing and environmental: `quality-migration/__tests__` fails at module load because `@/lib/auth` refuses to start without a `JWT_SECRET` env var — unrelated to this milestone (that module also carries pre-existing tsc errors). |

Per spec §22, known baseline issues remain unchanged; no unrelated module was modified to make a global gate green.

## §11 Hard Scope Lock — Compliance

Not implemented (verified): Attendance KPI, PerformanceFactor composition, Unified Performance Engine, daily attendance redesign, weekly-off redesign, reconciliation, fingerprint deduplication/idempotency, employee matching overhaul, Sales KPI, Quality KPI redesign (engine untouched), Admin Control Layer, User Workspace, Close/Reopen Attendance (beyond the existing Quality lifecycle), broad dashboard redesign, consumer migration. No attendance calculation rule and no `attendanceResults` storage-model change.

## §12 Recommendation for the Next Milestone

**Milestone 5 — Employee 360 Performance History (consumer adoption, first contract consumer):** introduce a scoped Employee 360 performance endpoint that reads stored `attendanceResults` (M3) + Quality `monthSnapshots` per employee-month and returns the three contract layers (`current` / `history` / `career`) built with `buildEmployeePerformanceLayers`, each section labeled via `TIME_SCOPE_LABELS_AR`, with HR deductions exposed as their own per-month, explicitly-attributable domain. This is the smallest real consumer of the contract: it exercises time-scope resolution, month-keyed storage reads, and the current-vs-history split end-to-end without touching any KPI formula. Attendance KPI / PerformanceFactor work should follow only after this consumer validates the contract in production shape.

---

**ATTENDANCE MILESTONE 4 — COMPLETE**
