# ARM ERP — Phase 2: Enterprise Attendance & Policy Engine
## Milestone 5 Completion Report — Employee 360 Performance History Consumer

**Date:** 2026-08-16
**Predecessors:** `docs/PHASE2-MILESTONE1-ATTENDANCE-AUDIT.md`, `docs/PHASE2-MILESTONE2-COMPLETION-REPORT.md`, `docs/PHASE2-MILESTONE3-COMPLETION-REPORT.md`, `docs/PHASE2-MILESTONE4-COMPLETION-REPORT.md`

---

## §1 What This Milestone Is

The **first real consumer adoption** of the shared Time-Scope + Performance-History contract (M4). Employee 360's performance view now separates, explicitly and by label:

| Layer | Content | Guarantee |
|---|---|---|
| **Current** — `الشهر الحالي` | the current calendar month's OWN stored results (Attendance / Quality / HR), per-domain `null` when not generated | history is never promoted into current; no fabricated values (never a default 100) |
| **History** — monthly list | stored monthly results for strictly earlier months, most recent first, per-domain presence | values exactly as stored — no recalculation from raw data, no cross-month overwrites, current month never duplicated |
| **Career** — `المسار الوظيفي (كل الفترات)` | derived aggregations over ALL stored monthly results (`sampleSize`, first/last, best/worst, average, MoM deltas) via the M4 `buildEmployeePerformanceLayers()` | derived view only — never a new counter, never a trend algorithm, single result → no delta |

No Attendance KPI, no PerformanceFactor, no Unified Performance Engine, no Sales KPI (hard scope lock — §13 below).

## §2 Files Created

| File | Purpose |
|---|---|
| `src/lib/employee-performance/index.ts` | The scoped Employee 360 performance service: pure per-domain summarizers + the pure three-layer assembler + a thin batched reader/orchestrator (`getEmployeePerformance`). Imports **no calculation engine** (pinned by test). |
| `src/lib/employee-performance/__tests__/employee-performance.test.ts` | 26 focused Milestone 5 tests (§10 below) |
| `src/app/api/employee-performance/[employeeId]/route.ts` | `GET /api/employee-performance/[employeeId]` — thin route: employee-360 permission gate, strict TimeScope query parsing, delegates to the reader/assembler |
| `src/components/pages/employee360/EmployeePerformanceSection.tsx` | The scoped performance UI section (current-month overview, TimeScope selector + monthly history table, career summary, development view) |
| `scripts/milestone-5-runtime-verification.ts` | Read-only runtime verification against the real RTDB (§11) |
| `docs/PHASE2-MILESTONE5-COMPLETION-REPORT.md` | This report |

## §3 Files Modified

| File | Change |
|---|---|
| `src/components/pages/Employee360Page.tsx` | Performance tab integration (§7). One import added; `renderPerformanceTab` adapted. **Untouched:** all other tabs, hero card, top stats grid, timeline, risk logic, quality panel, data fetch. |

No file from the do-not-change list was modified: `src/lib/attendance/policy.ts`, `monthly-engine.ts`, `types.ts`, the `attendanceResults` storage model, `monthSnapshots` model, the Quality KPI engine, and the M4 `time-scope` contract are all byte-identical.

## §4 Employee Performance API

`GET /api/employee-performance/[employeeId]` — new focused endpoint (no existing equivalent service existed to extend; the Employee 360 aggregate route mixes scopes silently and stays untouched). Response = the §23 concept exactly:

```jsonc
{
  "employeeId": "…",              // canonical employeeId identity only
  "scope":  { "kind", "label", "describe", "months" },   // shared TimeScope vocabulary
  "currentMonthKey": "2026-08",
  "current":  { "month", "attendance", "quality", "hr" }, // per-domain stored summary | null
  "history":  [ { "month", "attendance", "quality", "hr" } ], // most recent first, no current month
  "career":   { "attendance", "quality", "hr" },  // CareerSummary per domain (contract fields)
  "sources":  { "attendance", "quality", "hr" }   // per-domain collection attribution
}
```

Query: `scope` = `career` (default) | `current_month` | `previous_month` | `selected_month` (+`month=YYYY-MM`) | `last_3_months` | `last_6_months` | `current_year` | `custom_range` (+`months=CSV`) | `day` (+`date=YYYY-MM-DD`). Malformed parameters → strict validation error (contract convention). Permission: `'view'` on `'employees'` — the identical gate as `/api/employee-360/[id]`.

`MetricResult`/`MonthlyPerformanceResult` (M4 §5/§13) are referenced at the type boundary only (`MetricSource` tags the `sources` domains); nothing instantiates a final performance result — that stays future work.

## §5 Current / History / Career Implementation

- **Current** (`assembleEmployeePerformance`): the current month key comes from the shared `toMonthKey(now)`; each domain's summary is read from its own month-keyed store at that key. Missing month → `null` per domain. **September-reset semantics tested:** a new month with no stored results yields three nulls while August remains only in history.
- **History:** union of months (across the three domains) with any stored value, strictly `< currentMonthKey`, sorted most-recent-first; filtered to the requested TimeScope window when one is given (`selectMonths` semantics). Duplicate employee/month records resolve **last-wins** (M3 regeneration replacement semantics) — deterministic, never duplicated. Single explicitly-selected months (day/selected/previous/current) always render their row so the UI shows the explicit no-data state (`لم يتم إنشاء نتيجة الحضور لهذا الشهر` / `لا توجد بيانات`) instead of a silent empty list.
- **Career:** per domain, the stored monthly summaries are wrapped in the contract's `MonthScopedResult` identity and passed to `buildEmployeePerformanceLayers()` with `extractValue` = compliance (attendance) / score (quality) / deductionDays (HR). Career therefore derives **only** from stored monthly results — never from the current score alone, raw records, live observations, or lifetime counters.

## §6 Data Sources (stored-first, attributable)

| Domain | Source | Rule |
|---|---|---|
| Attendance | `attendanceResults` (M3) — one cached collection read, filtered by `employeeId` | stored result first; missing month → explicit `null` + `لم يتم إنشاء نتيجة الحضور لهذا الشهر`; **never** regenerated and **never** recomputed from biometrics/attendance records inside Employee 360 |
| Quality | `monthSnapshots` (Phase 1) — one cached collection read; the employee's `employeeScores[employeeId]` entry extracted per month | closed **and** stored-open snapshots are read as stored (frozen values); no snapshot/entry → `null` — a 100 score is never fabricated; historical snapshots are never recomputed. The **live current-open-month** Quality behavior stays owned by the existing Phase 1 paths (`EmployeeQualityKpiPanel` in the Quality tab, `/api/kpi-dashboard`); the current-month overview card explicitly points there when no stored snapshot exists |
| HR | existing `hrDeductions` collection — one cached read, filtered by `employeeId`, grouped by its canonical `month` field | displayed as its own `خصومات HR` domain everywhere; never added into attendance or quality deductions; per-status breakdown exposed (parity with the existing Employee 360 HR aggregation, all statuses counted, breakdown visible) |

## §7 Performance / History UI Changes

`EmployeePerformanceSection` was added **inside the existing performance tab** (no page rewrite):

- **A. نظرة الشهر الحالي** — labeled `الشهر الحالي — أغسطس 2026` (exact month from `currentMonthKey`, Arabic month names): three cards (الحضور stored compliance + deduction days + day counts; الجودة stored score + deduction points + snapshot open/closed badge; خصومات HR days/count/amount). Missing → the explicit per-domain messages above. Footer note states no final KPI is displayed.
- **B/C. السجل الشهري** — scope chips built from the shared `TIME_SCOPE_LABELS_AR` vocabulary (المسار الوظيفي (كل الفترات) / الشهر الحالي / الشهر السابق / آخر 3 أشهر / آخر 6 أشهر / السنة الحالية) + `شهر محدد` picker (`generateMonthOptions`). The table shows month / attendance (compliance + deduction days) / quality (score + snapshot status) / HR days, with per-domain `لا توجد بيانات` / `لم يتم إنشاء نتيجة الحضور لهذا الشهر` states. **No second range system** — the selector maps 1:1 onto `TimeScope` kinds consumed by the API.
- **D. الملخص الوظيفي** — labeled `المسار الوظيفي (كل الفترات)`: per-domain sample size, recorded period, monthly average, best/worst month, latest MoM delta; `< 2` samples → `لا يوجد اتجاه بعد (يتطلب شهرين)` — no invented trend.
- **E. تطور الأداء (عرض تاريخي)** — the §19 progression: chronological bars of stored attendance compliance and stored quality scores (oldest → newest, current month appended only when its own stored result exists). Display of stored values only — no new scoring system.

**Replaced (per spec §26, explicitly):** the old performance-tab raw current-month attendance-rate bar (an "old monthly calculation" from raw records) and the mixed `إجمالي الخصومات` tile (quality + HR summed — violates HR attribution) were replaced by the canonical scoped section with separated domains. **Kept unchanged:** requests-approval and health bars (re-scoped under a `الشهر الحالي` badge) and the active-trips tile. All other Employee 360 sections are untouched and functional.

## §8 Caching / Batching Strategy

Three collection reads total per request, issued in one `Promise.all` — **no N+1** (no per-month or per-employee reads): `attendanceResults` via cached `getAll` (TTL.STATIC — same cache entry as `getAttendanceResultsForMonth`), `monthSnapshots` via cached `getAll` (one document per month), `hrDeductions` via cached `getAll` + in-memory filter. **No new caching system** — the existing `db.ts` TTL cache is reused (the db layer exposes no server-side filtering; a single cached collection read + in-memory filter is the established project pattern, and the snapshots collection is one small document per month).

## §9 Historical Immutability

Historical rows are projections of stored records only. The assembler performs no arithmetic on stored values (career math operates on the extracted series, never mutating records); employee/policy/rule changes cannot alter what is displayed for a closed month because nothing is recomputed from current state. Current employee changes (department/position/name) affect only current-month reads; stored snapshots/results keep their own frozen employee snapshots. The service is a reader — it has no write path at all.

## §10 Tests Added (26, all passing)

`npx tsx --test src/lib/employee-performance/__tests__/employee-performance.test.ts` — 26/26 ✔

- **Current layer:** current-month result per domain; missing month → per-domain nulls (quality: never a fabricated 100); history never promoted into current.
- **History:** strictly earlier months, most-recent-first, no current-month duplication, duplicate employee/month → last-wins (single row), values stored verbatim (later months never overwrite earlier), per-domain nulls in mixed rows.
- **Career:** derived from stored results with hand-checked average/best/worst/deltas (Apr 77 → Aug 91 series); quality career from snapshot entries; single result → no delta; empty → explicit empty state (sampleSize 0 / nulls); current month included only when its own result exists.
- **Cross-domain:** attendance values identical to the stored record projection; quality from stored entries (status + rank preserved); snapshot without this employee → quality null and no leaked month; HR aggregation (days/EGP/statuses) stays separate — HR days never added to attendance deductions; another employee's data never leaks.
- **Scope:** career (default) returns every stored month + `months: null`; `current_month` keeps history empty; `previous_month`; `selected_month` (incl. explicit empty row for a data-less month); `last_3_months` window (current excluded from history); `custom_range`.
- **No recalculation:** spy-loader test proves the orchestrator touches ONLY `employee / attendanceResults / monthSnapshots / hrDeductions` (exact call list asserted); unknown employee → null (404 path); static import guard asserts the service module imports none of `computeMonthlyAttendance` / `computeFreshMonthSnapshot` / `computeMonthSnapshot` / generation / close / reopen.

## §11 Runtime Verification (read-only, real production RTDB)

`npx tsx --env-file=.env scripts/milestone-5-runtime-verification.ts` — **22/22 checks passed** against the production Firebase RTDB (82 real employees; no writes performed):

- Reader assembled a real response for a real employee; current layer carried the calendar current month (2026-08).
- Current-month semantics live: no stored current attendance result → `current.attendance = null`; no stored current quality snapshot entry → `current.quality = null` (never fabricated); no HR records → `current.hr = null`. History-not-promoted verified on a real employee.
- History ordering / no-current-duplication / stored-collection cross-checks passed; sources metadata attributes the three collections.
- Career explicit empty state verified (sampleSize = stored months = 0); scope labels (`المسار الوظيفي (كل الفترات)`, `الشهر السابق`), `career:all-time` descriptor, data-bound `months: null`, `previous_month` filtering (explicit empty row for 2026-07) all verified.

**BLOCKED — production-only environment** (reported, not faked):

1. **Populated-history runtime paths** (verbatim stored attendance values, populated quality snapshot entries, HR months, hand-checked career averages against real stored months): the production stores are currently empty (`attendanceResults` absent — no generation ever run; `monthSnapshots` absent — no month ever closed; `hrDeductions` empty). Populating them requires state-changing actions (attendance generation / month close), which are not performed against production. The populated paths are covered by the 26 unit tests with hand-checked math; production stores were only **read**.
2. **HTTP-layer check** (`GET /api/employee-performance/[employeeId]` through a live server with a real authenticated session): requires credentials/a running authenticated session not available in this environment. The route's permission gate is code-identical to the established `/api/employee-360/[id]` gate and the parameter parsing is strictly validated; the data logic it delegates to is fully verified at service level.

## §12 Verification Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **19 errors — identical to the pre-existing baseline** (quality-kpi panel, kpi-dashboard/riskMetrics/quality-migration tests, workflow engine — the same list documented in M4). **Zero errors** in `src/lib/employee-performance/**`, `src/app/api/employee-performance/**`, `src/components/pages/employee360/**`, `Employee360Page.tsx`. |
| `npm run lint` (new/modified files) | `src/lib/employee-performance/`, `src/app/api/employee-performance/`, `src/components/pages/employee360/` → **0 problems**. `Employee360Page.tsx` → exactly its one pre-existing `react-hooks/set-state-in-effect` finding (verified byte-identical at HEAD via stdin lint). Project-wide pre-existing backlog unchanged; no unrelated module modified. |
| `npm test` | **533 tests: 532 pass, 1 fail** — the single failure is the documented pre-existing `quality-migration.test.ts` environmental failure (`JWT_SECRET` at module load). Baseline was 506/507; +26 new Milestone 5 tests, +1 pre-existing counting delta from the M4-era suite growth. All M2/M3/M4 suites still pass. |
| Focused Milestone 5 suite | **26/26 passing** |

Known baseline issues remain separate and untouched, per spec §30.

## §13 Hard Scope Lock — Compliance

Not implemented (verified): Attendance KPI / percentage-as-KPI (the UI shows the stored compliance value labeled as a stored monthly result, never as a final KPI), PerformanceFactor, Unified Performance Engine (no weights, no `Quality × 15%`-style composition, no placeholder final scores), Sales KPI, daily reconciliation, weekly-off redesign, fingerprint deduplication, employee identity overhaul (canonical `employeeId` everywhere), Attendance Close/Reopen, Admin Control Layer, User Workspace, dashboard redesign, Quality KPI redesign (engine untouched), broad Employee 360 redesign. The canonical attendance engine and both storage models are unmodified.

## §14 Recommendation for Milestone 6

**Attendance KPI / PerformanceFactor groundwork — only after review of this consumer.** Milestone 5 validated the contract end-to-end in production shape (time-scope resolution, month-keyed storage reads, current/history/career split, labels). The natural next milestone is the **Attendance KPI definition** on top of the persisted `attendanceResults` (a time-scoped attendance factor per month, composed with the reserved `MonthlyPerformanceResult` snapshot and the M4 weight contract) — preceded, if review agrees, by an operational step outside code: running the explicit `POST /api/attendance-results/generate` for the completed month(s) so the Employee 360 history/career views carry real production data. Until then the UI correctly shows the explicit no-data states.

---

**ATTENDANCE MILESTONE 5 — COMPLETE**
