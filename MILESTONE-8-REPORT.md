# Milestone 8 — Unified Reporting Architecture & Report Contract

## 1. Scope Delivered

- **Canonical Report Definition contract** (`src/lib/reports/types.ts`): typed, serializable report definitions with `reportId / name / description / domain / reportType / enabled / permission / timeMechanism / allowedScopes / allowedFilters / visibleColumns / availableMetrics / exportFormats / dataMode`.
- **Report Filter & Scope contracts** (`src/lib/reports/scope.ts`): pure resolution/validation of employee scope (single/multiple/all + allowed-modes enforcement), department scope, period (date-range ⇄ month-scope via the existing TimeScope), and allowed-filter picking.
- **Report data/response contract** (`src/lib/reports/response.ts`): the predictable envelope — `meta / filters / hasData / rows / summary / scope` — with LIVE/SNAPSHOT mode stamped per execution and summary intersected with declared metrics.
- **Report registry** (`src/lib/reports/registry.ts`): one registry + structural validation + permission-aware visibility/export resolution. Admin-overlay-ready (definitions are plain data).
- **Unified execution endpoint** `POST /api/reports/run` and **permission-filtered catalog** `GET /api/reports/catalog`.
- **Generic, definition-driven Excel export** (`src/lib/reports/excel.ts`) — one engine for every report, driven by `visibleColumns`/`availableMetrics` (ExcelJS, same library as existing exports).
- **Reference report end-to-end**: Quality Deductions Report (API + UI + export + tests).
- **Shared UI primitives** (`src/components/shared/reports/ReportView.tsx`): `ReportView`, `ReportSummaryCards`, `ReportTable`, `ReportEmptyState` — definition-driven, RTL, dark theme, responsive.
- **React Query hooks** (`src/hooks/use-report-queries.ts`) with non-colliding query keys and targeted invalidation support.
- **23 focused tests** covering the 12 mandated areas (§32).

## 2. Existing Infrastructure Reused (no duplicates created)

| Reused | Where |
|---|---|
| TimeScope contract (M4) — `resolveTimeScopeMonthKeys`, `describeTimeScope`, `isValidDayKey` | `scope.ts` period resolution |
| Permission system — `verifyPermission`, `authenticateFromRequest`, `PermissionsMap`, role presets | `/api/reports/run`, `/api/reports/catalog`, `canSeeReport/canExportReport` |
| `api-error.ts` envelope (`apiError`, `validationError`, `logServerFailure`) | both new routes |
| DB layer — `getAll`, `getEmployeeMap` (batched, no N+1) | quality-deductions runner |
| ExcelJS (existing export library) | `excel.ts` |
| `EmployeeSearchInput`, ui/Table/Select/Input/Badge/Skeleton/Button | `ReportView.tsx` |
| `generateMonthOptions`, `authFetch`, `apiFetch` | UI + export download |
| Query conventions (key factory, staleTime) | `use-report-queries.ts` |
| `qualityDeductions` collection + `QualityDeduction` type | runner (read-only) |

## 3. Architecture

```
Domain Data (qualityDeductions, attendanceResults, monthSnapshots, hrDeductions, travel…)
        ↓
Domain Engine / Canonical Result (computeMonthlyAttendance, month snapshots, KPI engines)
        ↓
Reporting Layer (registry → resolveReportRequest → runner → buildReportRunResponse)
        ↓
UI / Export (ReportView primitives · Excel engine · print)
```

The reporting layer **consumes** canonical stores. The reference runner performs zero KPI computation; the envelope drops any metric not declared in the definition (enforced by tests — see §9).

## 4. Report Contract (final types)

- `ReportDefinition` — serializable definition (§1 list above).
- `ReportType` = `operational | performance | comprehensive`.
- `ReportDataMode` = `live | snapshot | hybrid` — stamped per execution (`ReportDataModeInfo { dataMode, scopeLabel, source }`).
- `ReportTimeMechanism` = `date-range | month-scope | both`.
- `EmployeeScope` = `{mode:'single',employeeId} | {mode:'multiple',employeeIds} | {mode:'all'}`; `ReportPermissionSpec.allowedEmployeeScopeModes` enforces per report.
- `ReportFilterSpec { key, label, control, required?, options? }` with control vocabulary (`month-select`, `date-range`, `employee-single`, `employee-scope`, `department`, `select`, `text`, …).
- `ReportColumnSpec`/`ReportMetricSpec` with `origin: 'raw' | 'canonical'` + `source: MetricSource` (canonical values must declare source — validated).
- `ReportRunRequest` → resolved by `resolveReportRequest` → `ReportRunnerResult` → `ReportRunResponse` envelope.

## 5. Report Registry

Registered: **`quality-deductions`** (operational · live · both time mechanisms · reports:view · single/multiple/all employee scopes · view/print/excel).

Resolution API: `listReportDefinitions`, `getRegisteredReport` (unknown/disabled → null), `getReportDefinition`, `validateReportDefinition`, `validateRegistry`, `canSeeReport`, `canExportReport`, `listVisibleReports`.

## 6. Reference Report — Quality Deductions

- **Day-first rule**: `deductionDays` is the primary impact; `monetaryAmount` (`deductionAmount` in store) is OPTIONAL and independent — never derived from each other. Financial and performance impact stay separate; no KPI value is produced.
- **Filters**: monthKey (default current month) ⇄ fromDate/toDate switch, employee (single or all; API supports multiple), department, category (stored `type`).
- **Metrics**: `deductionCount`, `totalDeductionDays` (days), `totalMonetaryAmount` (EGP).
- **Rows**: employee, department, category, description, date, month, deductionDays, monetaryAmount, relatedCapaId — sorted newest-first with Arabic collation.
- **Export**: definition-driven Excel (RTL sheet, Arabic headers, summary row), gated by the page's `export` action server-side; print via the browser.
- **Page**: `تقرير خصومات الجودة` in the reports sidebar group, mounted at `qualityDeductionsReport`, reusing permissionKey `reports` (all existing role grants apply unchanged).

## 7. Security

Backend enforcement order in `POST /api/reports/run`: registry resolution (404 unknown/disabled) → `verifyPermission(pageId, action)` (JWT + effective permissions, 403) → `resolveReportRequest` (400 on disallowed employee-scope mode / malformed period / out-of-contract filters; unknown filters dropped) → runner (scope+department applied to rows) → envelope. Excel additionally requires the `export` action. `GET /api/reports/catalog` computes visibility + `canExport` server-side. Frontend hiding (page entry, disabled export button) is UX only.

## 8. Time Scope

- Operational path: `fromDate/toDate` (day keys validated; containing month keys derived for month-keyed stores).
- Monthly path: `TimeScope` (selected_month/monthKey shorthand → presets → default current_month) resolved through the canonical `resolveTimeScopeMonthKeys`; `allowedScopes` rejects unsupported kinds (e.g. `career`/`day` for the reference report).
- LIVE vs SNAPSHOT is explicit: every response carries `meta.dataMode { dataMode, scopeLabel, source }`. The reference report is `live`; SNAPSHOT flows through the identical contract (pinned by tests) for future performance reports over `monthSnapshots`/`attendanceResults`.

## 9. Tests

`src/lib/reports/__tests__/reports.test.ts` — 23/23 pass, mapping to §32:
1. Definition validation (registry-wide + invalid type/dataMode/permission) ✔
2. Permission resolution (generic/HR/manager/admin/disabled; export gating) ✔
3. Employee scope enforcement (allowed-modes rejection) ✔
4. Department scope enforcement (orthogonal + combined) ✔
5. TimeScope handling (monthKey, presets, ranges, invalid input, defaults) ✔
6. LIVE vs SNAPSHOT in envelope meta ✔
7. Day-first quality deductions ✔
8. Optional monetary deduction ✔
9. No KPI in reporting layer (summary ⊆ declared metrics; envelope drops smuggled scores) ✔
10. Registry resolution ✔
11. Multi-employee scope ✔
12. Empty/no-data (`hasData:false`, no fabricated rows) ✔

## 10. Verification (vs. baseline)

| Gate | Baseline | After | New issues |
|---|---|---|---|
| `npx tsc --noEmit` | 19 errors (legacy files) | 19 errors | **0** |
| `npm test` | 609 pass / 1 fail (quality-migration) | 632 pass / 1 fail (same) | **0** (+23 new passing) |
| `npm run lint` (touched files) | Sidebar 1 err/1 warn pre-existing | identical (verified via `git stash`) | **0** |

## 11. Files Changed

**New (11):** `src/lib/reports/{types,scope,registry,response,excel}.ts`, `src/lib/reports/runners/quality-deductions.ts`, `src/lib/reports/__tests__/reports.test.ts`, `src/app/api/reports/run/route.ts`, `src/app/api/reports/catalog/route.ts`, `src/hooks/use-report-queries.ts`, `src/components/shared/reports/ReportView.tsx`, `src/components/pages/reports/QualityDeductionsReport.tsx`.

**Modified (4, additive only):** `src/types/index.ts` (PageId + `'qualityDeductionsReport'`), `src/config/permissions.ts` (one APP_PAGES entry, same permissionKey `reports`), `src/app/page.tsx` (dynamic import + router case), `src/components/layout/Sidebar.tsx` (FileWarning icon).

## 12. Forbidden Modules — Untouched

Legacy ReportsPage, KPI engines (`kpi-scoring`, attendance KPI), attendance engine/monthly-results, month snapshots/close, HR-performance, employee-performance, quality observations, TimeScope module, permissions internals, audit system, workflow engine — none modified. No business logic, formula, or canonical store changed.

## 13. Future Extension Proof

Adding each future report = **one definition + one runner appended to the registry** — no new foundation:

- **Attendance Daily (operational/live/date-range)**: runner reads daily attendance/biometrics; same envelope.
- **Attendance Monthly + Quality Observations (performance/snapshot)**: runner reads stored `attendanceResults` / `monthSnapshots` entries — columns/metrics with `origin:'canonical'` + `source` (validated); never recalculates.
- **HR (live)**: `hrDeductions` aggregation keeping financial vs performance impact separate (mirrors employee-performance's `EmployeeHrMonthSummary`).
- **Sales/Deals (live)**: `travel` records with employee/department/date filters; sensitive customer fields can be dropped server-side in the runner before the envelope.
- **Comprehensive Employee Report (comprehensive/hybrid)**: composes the per-domain runners' canonical summaries — `MonthScopedResult`/history helpers from TimeScope already provide the monthly series (best/worst/trend).
- **Attendance Reconciliation**: operational runner comparing daily status vs official monthly result — a new definition, not a new architecture.

## 14. HARD STOP

No next milestone was started. Attendance Report, HR Report, Sales Report, Comprehensive Employee Report, Unified Performance Engine, Employee 360 expansion, dashboard/sidebar personalization, and the Report Builder UI were **not** implemented — the architecture is ready for them per §13.
