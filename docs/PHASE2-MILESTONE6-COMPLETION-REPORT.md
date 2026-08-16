# ARM ERP — Phase 2: Enterprise Attendance & Policy Engine
## Milestone 6 Completion Report — Attendance KPI + PerformanceFactor Groundwork

**Date:** 2026-08-16
**Predecessors:** `docs/PHASE2-MILESTONE1-ATTENDANCE-AUDIT.md`, `PHASE2-MILESTONE2-COMPLETION-REPORT.md`, `PHASE2-MILESTONE3-COMPLETION-REPORT.md`, `PHASE2-MILESTONE4-COMPLETION-REPORT.md`, `PHASE2-MILESTONE5-COMPLETION-REPORT.md`

---

## §1 What This Milestone Is

The Attendance KPI is now an **independent, time-scoped performance factor** derived from the persisted monthly result. It establishes the factor contract — not the Unified Performance Engine:

```
raw attendance inputs → canonical engine (M2) → attendanceResults (M3) → Attendance KPI (M6) → PerformanceFactor
```

The KPI layer is a **consumer** of the stored result: it computes nothing, recalculates nothing, and writes nothing. A future Unified Performance Engine can consume `factorId: 'attendance'` without redesign.

## §2 Attendance KPI Definition & Source of Truth

**Attendance KPI Score = `attendanceResults.compliance`**, verbatim, with `maxScore = 100`.

- No second attendance formula was created; the compliance percentage is never recomputed in the KPI layer (spec §4).
- The KPI reads ONLY the persisted `attendanceResults` collection — never raw biometrics, raw attendance records, requests, waived deductions, the Daily Attendance UI, or the Reports raw calculation (spec §2, pinned by tests §10).
- **Parity guarantee (§24):** `stored.compliance === kpi.score === performanceFactor.score` — no rounding, no clamping, no alteration of the source value (a 0–100 sweep test pins every integer value, including fractional ones).

The KPI does not replace the operational Attendance Result (`presentDays`/`compliance`/…); it is the performance-factor **representation** of it (spec §5).

## §3 Files Created

| File | Purpose |
|---|---|
| `src/lib/attendance/kpi.ts` | The Attendance KPI service: pure builders (`buildAttendanceKpi`, `buildAttendanceKpiBreakdown`) + thin loader-injected orchestrators (`getAttendanceKpi`, `getAttendanceKpisForMonth`) over the EXISTING M3 readers. Zero raw calculations, no Firebase writes, no React. |
| `src/lib/attendance/__tests__/kpi.test.ts` | 25 focused Milestone 6 tests (§11 below) |
| `src/app/api/attendance-kpi/[month]/[employeeId]/route.ts` | `GET` — one employee-month KPI (§5 below) |
| `src/app/api/attendance-kpi/[month]/route.ts` | `GET` — safe batch/list read for the month (§6 below) |
| `scripts/milestone-6-runtime-verification.ts` | Read-only runtime verification against the real RTDB (§12 below) |
| `docs/PHASE2-MILESTONE6-COMPLETION-REPORT.md` | This report |

## §4 Files Modified

| File | Change |
|---|---|
| `src/lib/attendance/index.ts` | Additive barrel exports for the `kpi` module only (constants, builders, orchestrators, types). No existing export changed. |
| `src/components/pages/employee360/EmployeePerformanceSection.tsx` | One strictly-additive line in the current-month Attendance card: `مؤشر أداء الحضور (KPI): {compliance} / 100` (§9 below). Also removed a stray `</span>` typo on the adjacent line that JSX would have ignored. |

No file from the do-not-change list was modified: `src/lib/attendance/policy.ts`, `src/lib/attendance/monthly-engine.ts`, the `attendanceResults` storage model (`monthly-results.ts`), the Quality KPI engine, `monthSnapshots`, and the M4 `time-scope` contract are untouched — the KPI service only **imports readers and types** from them.

## §5 KPI Service & Result Contract

`src/lib/attendance/kpi.ts` implements the spec §11 shape:

```jsonc
{
  "employeeId": "…",
  "employeeName": "…",          // stored employee snapshot, verbatim
  "department": "…|null",       // stored employee snapshot, verbatim
  "month": "2026-08",           // its OWN month — never inherited
  "scope": { "kind": "selected_month", "monthKey": "2026-08" },  // shared TimeScope vocabulary (M4)
  "score": 93,                  // = stored compliance, verbatim
  "maxScore": 100,
  "normalized": 0.93,           // score / maxScore, full precision
  "performanceFactor": {        // generic @/lib/kpi-scoring PerformanceFactor
    "factorId": "attendance",
    "factorName": "الحضور",
    "score": 93, "maxScore": 100,
    "weight": 1,                // type-required default-safe placeholder ONLY (§8 below)
    "normalized": 0.93,
    "breakdown": {              // read verbatim from the stored result — nothing re-derived
      "presentDays": …, "lateDays": …, "absentDays": …, "exemptDays": …,
      "lateDeductionDays": …, "absenceDeductionDays": …,
      "attendanceDeductionDays": …, "compliance": 93
    }
  },
  "source": "attendanceResults",
  "engineVersion": "attendance-v1",     // preserved from the stored result
  "policyFingerprint": "1a2b3c4d",      // preserved from the stored result
  "generatedAt": "…"                    // the generation run, not the KPI read
}
```

**PerformanceFactor integration (§6).** The generic `@/lib/kpi-scoring` `PerformanceFactor` type is reused — no `AttendancePerformanceFactor`, no second scoring/weight interface. The factor is built through the **established direct adapter** (the same pattern as the Quality dashboard's factor at `src/lib/kpi-dashboard/index.ts`): compliance is already a 0–100 scale, so `toPerformanceFactor()`'s `score + deductions` maxScore reconstruction would be **wrong** here (attendance deduction days are day-counts, not score points; 0 deduction days would collapse maxScore to the score itself). A test pins `maxScore = 100` even at compliance 100.

**Weight (§7 scope rule).** `weight` is required by the generic type, so the default-safe placeholder `1` is exposed (same convention as Quality's factor) — explicitly NOT a composition decision. No final employee KPI is computed anywhere; the system remains ready to compose Quality + Attendance + Sales + HR factors in the future engine without changing this contract.

**Time scope (§8/§9).** Every KPI carries `scope: { kind: 'selected_month', monthKey }` from the shared M4 vocabulary — "Attendance KPI — August 2026", never an unlabeled number. Historical KPIs are read from the historical stored results; September returns `not_generated` until September itself is generated — August's KPI is never carried forward (pinned by test).

## §6 API Endpoints

**`GET /api/attendance-kpi/[month]/[employeeId]`** — one employee-month KPI.
- Authenticates (JWT) + enforces `'view'` on `'reports'` — the identical gate as the `/api/attendance-results` read routes serving the same stored data.
- Strict month (`YYYY-MM`) and employeeId validation.
- Reads `attendanceResults` via the service; **200** → the `AttendanceKpiResult`; **404** → `{ "status": "not_generated", month, employeeId }`.
- NEVER regenerates, NEVER computes, NEVER writes Firebase.

**`GET /api/attendance-kpi/[month]`** — safe batch read (spec §14) for Employee 360 / dashboard consumers: `{ month, kpis: […], meta: { count, total } }` with optional `employeeId`, `department`, `limit`, `offset` filters — the exact conventions of the M3 list route. An ungenerated month returns an empty list, never fabricated values.

## §7 Not-Generated Behavior (Production Preflight)

No KPI endpoint or service ever calls generation. A missing stored result surfaces as the explicit `not_generated` state (404 single / empty list batch) — never a fallback to raw biometrics, never a fresh compliance computation, never a fabricated 100, never another month's value. The only generation path remains the separate, explicit, permission-gated `POST /api/attendance-results/generate`. This milestone introduces **zero automatic Production writes**.

## §8 Policy Traceability

The KPI result preserves `engineVersion` + `policyFingerprint` from the stored result, so "why did this employee receive this Attendance KPI?" is answerable historically without recalculating any policy snapshot (tests pin both fields against the stored record).

## §9 Employee 360 Integration Status — Strictly Additive

Milestone 5's current-month Attendance card already displays the stored compliance. Added **one line** beneath it, clearly labeled `مؤشر أداء الحضور (KPI): 93 / 100` — exactly the spec §16 representation (compliance% + KPI score/100). The value is the same stored compliance the card already renders; KPI score ≡ compliance is pinned by the parity tests, so no extra fetch is needed and the two displays cannot diverge. It is labeled "Attendance KPI" — never "Final KPI"/"Overall Performance". No other Employee 360 section, tab, or contract was touched. (Also fixed a harmless stray `</span>` typo on the adjacent line.)

## §10 Domain Separation

- **Quality separation (§18):** no merge of Attendance + Quality into any combined score; the Quality dashboard was not modified.
- **HR separation (§19):** HR deductions are not absorbed — a test proves an HR field on the input cannot alter the KPI score, and the output key-set contains only attendance-domain values.
- **Sales separation (§20):** no Sales placeholders, no fake values, no final score displayed anywhere.

## §11 Tests — 25/25 Passing

`src/lib/attendance/__tests__/kpi.test.ts` (run: `npx tsx --test src/lib/attendance/__tests__/kpi.test.ts`):

| Group | Coverage |
|---|---|
| KPI score | compliance 100→100, 95→95, 0→0; full 0–100 sweep (score + normalized stay in range, value never altered); fractional parity |
| Stored-result source | KPI derives from `StoredAttendanceResult` fields only; orchestrator touches ONLY the attendanceResults loader (spy loaders); module statically imports no engine / `@/lib/db` / biometric / raw-attendance path (source-import pin, M5 pattern) |
| Not generated | missing result → explicit null; no cross-employee / cross-month leakage; batch of ungenerated month → `[]`; invalid month key throws; corrupt stored identity surfaced, never silently returned |
| Time scope | explicit `selected_month` scope for its own month; July=88 / August=93 / September=null (no inheritance); building a KPI never mutates the historical record |
| PerformanceFactor | `factorId: 'attendance'`, `factorName: 'الحضور'`, score = stored compliance, `maxScore: 100` (no collapse at 100), `normalized`, weight = default-safe 1, breakdown verbatim, `engineVersion` + `policyFingerprint` preserved |
| Domain separation | output key-set contains only attendance-domain values; an HR deduction on the same month does not alter the KPI |
| Batch | one KPI per stored employee of the month, months isolated |
| Engine anchors | real `computeMonthlyAttendance` outputs (perfect month → 100; absence month → engine compliance exactly) — tying the KPI to the actual engine, not just synthetic records |

## §12 Runtime Verification (READ-ONLY, Real Production Firebase)

`npx tsx --env-file=.env scripts/milestone-6-runtime-verification.ts` — strictly read-only (no create/update/delete, no generation, no cache invalidation).

**Result:**

```
Persisted attendanceResults: 0 record(s) across month(s): [none]

ATTENDANCE KPI RUNTIME DATA — NOT GENERATED
No persisted attendanceResults exist in this environment.
Per spec: the KPI layer must NOT generate data automatically.
An authorized Admin may generate a completed month separately via
POST /api/attendance-results/generate.

── not_generated path (no stored data anywhere) ──
  ✔ ungenerated employee-month returns explicit null (not_generated)
  ✔ ungenerated month batch read returns []

══ Result: 2/2 checks passed (data-dependent checks skipped — nothing generated) ══
```

Connectivity was verified independently (a live read returned 82 real employees), so "0 records" is a genuine empty collection, not a masked error. Per spec §25 the data-dependent checks (real month/employee parity, factor metadata, fingerprint/version, cross-month isolation, batch parity) were **skipped — nothing was generated and no results were faked**. The script runs them automatically once persisted results exist. (Note: standalone tsx scripts need `--env-file=.env`; the admin RTDB connection keeps the process alive, so the script exits explicitly.)

**Operational note:** an authorized Admin may explicitly generate a completed month (e.g. 2026-07) via `POST /api/attendance-results/generate` to enable the full data-dependent verification — this was deliberately NOT done in this milestone.

## §13 Verification Gate

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **19 errors — identical to the pre-existing baseline** documented in M4/M5 (quality-kpi panel, kpi-dashboard/riskMetrics/quality-migration tests, workflow engine). **Zero errors** in `src/lib/attendance/kpi.ts`, `src/lib/attendance/__tests__/kpi.test.ts`, `src/lib/attendance/index.ts`, `src/app/api/attendance-kpi/**`, `scripts/milestone-6-runtime-verification.ts`, `EmployeePerformanceSection.tsx`. |
| `npm run lint` | All Milestone 6 files → **0 problems**. Project-wide pre-existing backlog (559 errors / 11,295 warnings) unchanged; no unrelated module modified. |
| `npm test` | **558 tests: 557 pass, 1 fail** — the single failure is the documented pre-existing `quality-migration.test.ts` environmental failure (`JWT_SECRET` at module load), identical to the M5 baseline. 533 (M5) + 25 new M6 tests = 558. All M2–M5 suites still pass. |
| Focused M6 suite | **25/25 passing** |

## §14 Hard Scope Lock — Compliance

Not implemented (verified): Unified Performance Engine, Quality × 15% composition, final employee KPI score, Sales KPI/placeholders, HR PerformanceFactor, Attendance Close/Reopen, Daily Attendance redesign, Weekly-Off redesign, fingerprint reconciliation/deduplication, employee matching overhaul, Admin Control Layer, User Workspace personalization, broad Employee 360 or Dashboard redesign, Quality Dashboard changes, new attendance calculation rules. The do-not-modify list is byte-untouched (§4).

## §15 Known Baseline Issues (Separate, Untouched)

1. 19 pre-existing `tsc` errors (quality-kpi panel, kpi-dashboard/riskMetrics/quality-migration tests, workflow engine) — same list as M4/M5.
2. Pre-existing `quality-migration.test.ts` environmental failure (`JWT_SECRET` at module load).
3. Project-wide lint backlog (559 errors / 11,295 warnings).
4. Production has **zero persisted `attendanceResults`** — the KPI layer is verified against fixtures + the live `not_generated` path; full data-dependent runtime verification awaits an explicit Admin generation of a completed month.

## §16 Exact Recommendation for Milestone 7

**Milestone 7 — HR PerformanceFactor groundwork, following the exact M6 pattern:** a `src/lib/hr-performance/` (or `employee-performance`-hosted) service that derives an independent, time-scoped HR factor from the existing stored `hrDeductions` aggregation (M5's `aggregateHrMonth`), exposing `factorId: 'hr'` through the same generic `PerformanceFactor` — with the same parity/no-recalculation/not-generated/time-scope test discipline. This completes the third of the four factors the Unified Performance Engine needs (Quality ✓, Attendance ✓, HR → M7; Sales requires new data capture and stays later).

**Prerequisite (operational, not code):** an authorized Admin should explicitly generate one completed month via `POST /api/attendance-results/generate` so the M6 data-dependent runtime verification (already scripted) can execute against real data.

**Alternatives (if HR factor is deferred):** Attendance Close/Reopen (month locking) — it hardens the historical results the KPI depends on — or beginning the Unified Performance Engine skeleton with configurable weights (composition disabled by default).

---

**Milestone 6 deliverables:** Attendance KPI service + PerformanceFactor integration (`src/lib/attendance/kpi.ts`), single + batch read APIs (`/api/attendance-kpi/[month][/employeeId]`), 25 focused tests, read-only runtime verification, strictly-additive Employee 360 KPI label. Source of truth: persisted `attendanceResults` only. Zero Production writes introduced.

ATTENDANCE MILESTONE 6 — COMPLETE
