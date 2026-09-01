# Phase 6.3 — Persistent UI State + Report Continuity + Search Deep Navigation + KPI Visibility

Date: 2026-09-02 · Scope: Phase 6.3 (spec §0-§66) over the Phase 5.3/6.1/6.2 state.

## 1. Page State Persistence (`src/lib/page-state/`)

- `persistence.ts` — ONE versioned, user-scoped storage abstraction (§4):
  key = `arm-erp:page-state:{s|l}:{userId}:{page}:{slot}:v{version}`;
  envelope = `{ v, env, savedAt, state }`. Absent/corrupt/version-mismatch
  reads return `null` — old state never breaks a page (§7/§44).
- Storage doctrine (§5): `sessionStorage` for page work context
  (filters/period/sort/search); `localStorage` reserved for report
  snapshots. Nothing sensitive is stored; server ALWAYS re-authorizes.
- `hooks/use-page-state.ts` — drop-in filter-state hook:
  restore-once per mount (deferred rAF), debounced writes (250ms) +
  unmount flush, `reset()` = REMOVE record + page default (§9),
  `skipRestore` lets an explicit navigation seed (search result month,
  §27) win over the remembered state, `validate` rejects invalid
  shapes (§43 fail-safe), no identity → no read/write (§6).

## 2. Report Continuity (`src/lib/report-state/` + ReportsPage)

- `report-snapshot.ts` — snapshot contract (§14): reportId/reportType/
  subject/period/filters/generatedAt/generatedBy/stateVersion/data.
  Level B persistence (§15): client-side, user-scoped, NO new DB model.
- ReportsPage: restored reports come back VERBATIM with their period +
  an explicit «تمت الاستعادة — لم يُعَ احتسابه» badge (§16/§20); the
  ONLY write path is the explicit Generate (§18/§21); changing the
  month selector never rewrites the snapshot — a visible amber hint
  flags the mismatch (§19). Replaced the legacy unscoped
  `erp_report_data` session key (cross-user leak + month/report
  mismatch bug).
- Live views stay live (§51): KPI Reports tabs + Smart Quality Report
  persist SELECTIONS ONLY (tab/month/employeeId), never data.

## 3. Search Deep Navigation (§22-§32)

- qualityDeductions upgraded generic → EXACT: stable `data-record-id`
  rows on QualityPage + shared `useRecordHighlight` + auto-expansion of
  the OWNING employee group (§25) + month seeding (§27). Honest
  fallbacks unchanged for knowledgeBase/monthSnapshots/orgNodes/users.
- CAPA (detailParam), Observations/Complaints/FollowUps/Travel
  (highlight), Requests (row mechanic) — reused, not duplicated.

## 4. KPI Employee Visibility (§33-§37)

- FORENSIC RESULT: the monthly/MTD/historical pipeline is structurally
  sound — rows exist for EVERY eligible ∩ scoped employee (PENDING /
  NO_SCHEME rows included); loaders have no limits; UI defaults are
  'all'. An employee can only drop out at: employee record missing
  (orphan observation employeeId), scope, or eligibility (lifecycle).
- NEW read-only diagnostic: `traceEmployeeKpiVisibility` (pure, reuses
  the report loaders — computes NO KPI values) + `GET
  /api/kpi-reports/diagnose` (auth + kpiReports view + scope; out-of-
  scope ids get the generic anti-enumeration answer) + a «تشخيص
  الظهور» panel in the Employee report tab reporting the FIRST layer
  where the employee disappears.
- §36 rules verified by tests: observations never create eligibility;
  zero observations never hide an eligible employee.

## 5. Period UX (§10/§39/§56)

- KpiReportsPage: explicit «الفترة الحالية: …» + open/FINALIZED marker.
- Contextual empty states with the NAMED period on Quality /
  Attendance / Requests / Biometric (Observations already §68).

## 6. Verification

- `tsc --noEmit` 0 errors · `eslint` clean · `npm test` 1279/1279
  (baseline 1223 + 56 phase-6.3 tests, incl. 3 legitimately updated
  Phase 5.3/6.1 contracts for the qualityDeductions upgrade) ·
  `npm run build` success with `ƒ /api/kpi-reports/diagnose` ·
  standalone smoke: `/` 200, diagnose unauth 401.
- Vercel-compatible: client storage + standard API route, no new
  infra. Production NOT deployed/verified from here (honest).

## 7. Files

- Added: `src/lib/page-state/{persistence.ts,__tests__/page-state.test.ts}`,
  `src/lib/report-state/{report-snapshot.ts,__tests__/report-snapshot.test.ts}`,
  `src/lib/kpi-reporting/{visibility-trace.ts,__tests__/visibility-trace.test.ts}`,
  `src/hooks/use-page-state.ts`,
  `src/app/api/kpi-reports/diagnose/route.ts`,
  `src/lib/search/__tests__/phase63-deep-navigation.test.ts`
- Modified: ReportsPage, ObservationsPage, TravelPage, ComplaintsPage,
  FollowUpsPage, QualityPage, AttendancePage, RequestsPage,
  HrDeductionsPage, BiometricPage, EmployeesPage, CAPAPage,
  KpiReportsPage, KpiMonthlyTableTab, SmartQualityReportPage,
  KpiEmployeeReportTab, use-kpi-queries, evidence-collections,
  search-navigation, global-search/phase53/evidence-preview tests
- Deleted: none. KPI formulas/weights, analytics, AI, Evidence data:
  untouched (§1/§41/§58 respected).
