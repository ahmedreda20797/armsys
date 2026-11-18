# QNALYS — COMPLETION PHASE DELIVERY REPORT
## Performance Hub & KPI Reports — Gap Closure, Metric Validation & Production Readiness

**Date:** 2026-11-16
**Scope:** Completion phase per mission spec — metric validation (P1), Hub custom selection & multi-person reporting (P2), KPI Reports flexible periods (P3), localization audit (P4), TypeScript/ESLint/build (P5).

---

## A. Metric Validation — Customer & Deal Follow-up

### A.1 Investigation conclusion (the authoritative source)

The full data model was traced before any change. **Qnalys stores NO authoritative source for actual customer follow-up activity:**

| Source inspected | What it stores | Follow-up data? |
|---|---|---|
| `travelDeals` + `bookingItems` | Supplier-booking state per service row (`booked`/`pending`/`missing`), labels, details | **No** — no contact dates, no follow-up deadlines, no completion timestamps, no history |
| `followUps` collection | INTERNAL employee action follow-ups (`employeeId` mandatory, `followUpType` quality/behavior/…, `relatedDeductionId`/`relatedCapaId`) | **No** — no `dealId`/`customerId` link; never a customer-follow-up record |
| `complaints` | Complaint handling (has `dealId`) | No — complaint records, not proactive follow-up events |
| AOCC `customer_follow_up` decision type | "Open complaint needing customer response" | A complaint-driven decision label, not follow-up activity records |

The previous implementation's mapping (`booked = completed customer follow-up`) conflated **booking execution** with **customer follow-up** — two different business concepts. Per the mission rules, the metric was NOT rebuilt on a fabricated source.

### A.2 Implemented semantics

1. **Customer & Deal Follow-up is explicitly `NOT_MEASURABLE`** — a new structural verdict `CustomerFollowUpMeasurability { status: 'NOT_MEASURABLE', reason: 'NO_CUSTOMER_FOLLOW_UP_SOURCE', missingSource }` is carried on every `EmployeePerformanceDataset` (`assessCustomerFollowUpMeasurability()` in `operations-analysis.ts`). No percentage is fabricated from booking items; the verdict changes only when a dedicated follow-up source is ever introduced.
2. **Booking Execution is the separate business-output metric** — `aggregateBookingExecution()` (renamed from `aggregateCustomerDealFollowUps`) measures the supplier-booking state of the period's deal items verbatim; dataset field `bookingExecution`.
3. **Hub dimensions** — the follow-up domain now presents THREE never-merged dimensions:
   - `customerDealFollowUp` → always `NOT_MEASURABLE` (new status) with the bilingual explanation in `details.customerDealFollowUp` and a data-quality note (`note.customerFollowUpNotMeasurable`).
   - `bookingExecution` → measurable booking completion (`bookingCompletion` metric, thresholds `BOOKING_OPEN_ATTENTION/AREA`, `BOOKING_STRONG_COMPLETION`).
   - `employeeActionFollowUp` → internal follow-ups, unchanged.
4. **Labels, changes, cross-signals, strengths/areas/concerns/recommendations** re-keyed to booking-execution semantics (`bookingCompletion`, `openBookingItems`, `strength.bookingExecutionComplete`, `area.openBookingItems`, `rec.bookingExecutionReview`, `overlap.dealsBookingExecution`); the old customer-follow-up percentages no longer exist anywhere.
5. Overview doctrine extended: `NOT_MEASURABLE` is excluded from "measurable" exactly like `INSUFFICIENT_DATA`.

### A.3 Acceptance tests (all implemented and passing)

- `analysis.test.ts 13a` — completing every booking (hotel/flight/…) leaves the customer-follow-up dimension `NOT_MEASURABLE` with `value: null`; booking execution itself reads 100%/STRONG.
- `analysis.test.ts 13b` — internal action follow-ups never affect the customer & deal follow-up dimension.
- `analysis.test.ts 13c` — overview treats `NOT_MEASURABLE` like absent data (all-empty employee → `INSUFFICIENT_DATA`, never "stable").
- `analysis.test.ts 13d` — booking items drive `bookingCompletion` changes with `travel`-page evidence; no `customerDealFollowUp*` change items exist.
- `analysis.test.ts 3b/3c`, `performance-intelligence.test.ts 8b/8c/8d` — domain separation, item-state partition, structural verdict on every dataset, direct pure-aggregate checks.

**Exact formula:** booking completion = `bookedItems / totalItems × 100` over the period's deal items (null when no items). Customer follow-up: **no formula — structurally not measurable**, disclosed verdict instead.

---

## B. Employee Performance Hub — Custom Selection & Multi-Person Reporting

### B.1 Custom selection (§3.1)

- `POST /api/performance-hub/group` accepts `employeeIds` (arbitrary individuals from any team/company) + `orgNodeIds` (teams/departments/companies subtrees) — mixed selections, deduplicated by `Set` union, ≤ 100 ids per kind, ≤ 50 evaluated members per report (`GROUP_REPORT_MAX_MEMBERS`).
- **Scope enforcement (M0.5 doctrine):** the authorized employee set is resolved server-side; client ids can only narrow. Out-of-scope ids/nodes are NOT silently dropped — they are counted and reported back (`outOfScopeEmployeeIds` / `outOfScopeOrgNodeIds`); an org node is rejected unless the caller's scope covers its whole subtree (anti-leak).
- Population resolution uses the canonical Organization Tree (`buildOrgIndex` + `subtreeIds`); unknown node ids surface as rejected, never guessed.
- Every member row carries its REAL org context (team/department/company/manager from the tree) — a custom selection is always distinguished from actual organizational membership.

### B.2 Three reporting modes (§3.2)

- **A. Individual Reports** — the group page (`PerformanceHubGroupPage.tsx`) renders the EXISTING single-employee hub dataset per selected member with a member switcher; single-employee functionality untouched.
- **B. Consolidated Group Report** — one population report (`buildPerformanceGroupReport`): member count, coverage/completeness (`dataCompletenessPercent`, `membersWithoutData`), overview-status distribution, dimension rollups (status counts + averages over value-bearing members + `notMeasurableCount`), shared strengths, common weaknesses, repeated problems with member frequency, risk distribution, improving/deteriorating trends (strongest canonical §17 change per member), attention list with reasons. Denominators everywhere; never averages alone.
- **C. Comparison Report** — dimension-by-dimension unit comparisons GROUPED BY REAL ORG MEMBERSHIP (`team:`/`department:`/`company:`/`manager:` units) with consistent metric definitions and period; manager-to-manager rows included.

### B.3 Aggregation integrity (§3.3)

- The group layer consumes the canonical per-member hub datasets (`getEmployeePerformanceHubDataset`) — KPI, risk, attendance, deductions, deals are NEVER recalculated inside the group UI. Zero new metrics, one shared aggregation module (`group-report.ts`).
- Dedup (Set union), partial/missing data explicit (`hasData`, `failedEmployeeIds`, `membersWithoutData`), consistent period boundaries (one `monthKey` for all members), evidence preserved per member, hard cap with explicit truncation note, read-only (no writes anywhere).

### B.4 Manager analysis (§3.4)

- Manager grouping uses the RESOLVED manager (nearest team/department/company ancestor's `managerUserName`) — an arbitrary selection is never treated as a managed team. Per manager: member count, overview distribution, employees needing intervention, declining-dimension counts. Manager-to-manager comparison flows through the same unit-comparison table (`manager:` units).

### B.5 Authorization verification

- Route: `requireAuth` → `verifyPermission(request, 'employee360', 'view')` → `resolveEmployeeScopeFromDb` → section gates (`resolveEmployee360SectionGate`) for risk/HR — identical to the single-employee hub. Restricted blocks arrive as null; HR records are never read when unauthorized.
- Registry: new page id `employeePerformanceHubGroup` mounts under the SAME `employee360` permission key (existing grants apply), registered in `permissions.ts`, `PageId`, and the SPA router.

---

## C. KPI Reports — Flexible Reporting Periods

### C.1 Period architecture (§4.1)

- New canonical pure module `lib/kpi-reporting/flexible-period.ts`: kinds **day / week / month / quarter / six_months / year / custom_range** (spec §4 required list, complete). Reuses the canonical time utilities (`isValidDayKey`, `dayKeyToMonthKey`, `monthKeysBetween`) — no independent period engine.
- Conventions (ONE policy): inclusive day-key boundaries; local-timezone date math (the canonical convention); week = 7-day span from an explicit anchor (`weekStartOf` — Saturday start, the Egypt business week; no week-numbering system invented); quarter/half/year are CALENDAR spans (Q1 vs Q2 semantics); span cap 372 days with explicit rejection beyond it.
- **Independent comparison period** (§4): any kind, or `{ kind: 'previous_period' }` = the immediately-preceding equal-length span (calendar kinds step one calendar unit; day/week/custom shift by exact day count). `resolvePeriodWithComparison` REJECTS overlapping primary/comparison periods with an explicit Arabic validation message — overlapping comparisons are 400s, never misleading reports.

### C.2 Value basis (§4.2 — frozen-first preserved)

- Fully-covered months → the existing canonical assembly verbatim (frozen `FINALIZED` results on closed months, live `MTD`/`LIVE` on open months — untouched).
- **Partially-covered months (day/week/custom window edges)** → the ONE canonical scoring function `computeEmployeeScore` (the same function `computeMonthSnapshot` applies per employee) recomputes over the WINDOW'S approved observations with that month's stored `settingsSnapshot`. Always disclosed: month basis `LIVE` + `liveCalculated: true` (`monthBases` per span; span basis `FINALIZED`/`MTD`/`LIVE`/`MIXED`). The frozen full-month value is never narrowed silently; frozen snapshots are read, never overwritten.
- Historical month without a finalized snapshot → the canonical policy (LIVE, "not finalized") disclosed in `monthBases`.

### C.3 Report content (§4.3)

`buildFlexibleKpiInsights` (`lib/kpi-reporting/flexible-insights.ts`) produces: quality KPI averages (period + independent comparison + delta), approved/pending/rejected counts, category distribution with previous counts, severity distribution, repeated issues (canonical `detectRepeatedIssues`) + cross-month recurrence (`detectWindowRecurrence`), effective quality deductions (count/days/by-type + comparison count), team/department/company unit rollups with deltas, per-employee KPI rows with `monthsWithValue` denominators, data-quality notes. Scope/selection reuses the SAME effective-scope rule as the monthly insights workspace. Quality/KPI scope only — no HR decision-support responsibilities moved in.

### C.4 Surface wiring

- `GET /api/kpi-reports/insights-flexible` — same guards as the insights route (auth → kpiReports view → technical-audience guard → authorized scope; strict spec parsing; overlap/boundary errors → 400; HR-deduction masking for unauthorized viewers).
- UI: `FlexiblePeriodPicker` inside the ONE control bar (kind + value + independent comparison + swap); a bare month + auto-previous comparison collapses into the existing month flow (zero behavior change); non-month selections render `FlexibleReportView` sections. Print adapter `flexibleKpiInsightsToPrintModel` reflects the EXACT selected periods (both ranges + per-month live/frozen disclosure). Excel export via the existing `kpi-monthly` runner remains month-keyed (the flexible JSON endpoint is the period export surface).

### C.5 Acceptance tests (25 passing)

- `flexible-period.test.ts` (17): correct date ranges for every kind (leap-aware), invalid inputs rejected, partial-current-month flag, comparison independence (Nov 2026 vs Oct 2026; Nov 1–14 vs Oct 1–14; Q1 vs Q2), `previous_period` arithmetic (week, custom, month, quarter), overlap rejection (including a comparison inside the primary), Saturday-week anchors.
- `flexible-insights.test.ts` (8): independent month-vs-month deltas; custom-vs-custom; **window score = LIVE canonical recompute ≠ frozen full-month value** (97 vs 90 on the fixture); fully-covered spans keep frozen values verbatim; day-filtered distributions exclude out-of-window observations; observations loaded ONCE per month (no duplicate heavy queries); overlap rejection; org-node narrowing.

---

## D. Localization

### D.1 Resolver consolidation (one shared canonical resolver)

**Finding:** the legacy Arabic alias map lived only in `dynamic-labels.ts`, while `presentation.ts`'s `resolveSystemLabel` (used by `presentSystemOrVerbatim`, print adapters, exports) did NOT fall back to legacy aliases — a known legacy value («مكتملة») rendered raw in English through presentation paths.

**Fix:** `LEGACY_VALUE_LABELS` (70 aliases: observation categories, follow-up types, statuses, priorities) moved INTO `presentation.ts` (§3b) as the final step of the ONE `resolveSystemLabel` chain (entities → statuses → rules → legacy aliases); `dynamic-labels.ts` imports and re-exports it (public surface unchanged, no circular import). Every presentation path — page views, print adapters, Excel export, `presentSystemOrVerbatim` — now resolves legacy values.

### D.2 EN_MAP duplicates (§5.4)

Both duplicates were value-identical later copies (introduced by the Evidence-V2 block): `'الرابط': 'Link'` and `'ملف الصورة مطلوب': 'Image file is required'`. The originals (lines ~418/~557) were verified and kept; the duplicate copies removed. A programmatic scan now reports **zero duplicate keys**. Behavior unchanged (later key silently won with the identical value).

### D.3 Coverage tests (§5.5)

New `src/lib/i18n/__tests__/dynamic-labels-coverage.test.ts` (14 tests): legacy map completeness for the documented values (`تأخر متابعة` → Follow-up Delay, `مكتملة` → Completed, `مفتوحة` → Open, `متأخرة` → Overdue, `أداء ممتاز` → Excellent Performance), system-enum precedence over aliases, unknown business data → null/verbatim (user-content protection: names, notes, free text never translated), EN_MAP UI track coverage, approval-status vocabulary, `isKnownStoredLabel` boundary. The suite deliberately pins the contract; it does not claim "complete localization" beyond the verified chains.

### D.4 Protected content (§5.3)

Only known semantic values resolve; employee/customer names, notes, descriptions and arbitrary user text pass through verbatim (pinned by tests 2c/2d/3b/4b and the existing `i18n-boundary` suite — all passing).

---

## E. Quality Assurance

### E.1 Files changed

**Modified (37):** performance-intelligence (types/assemble/operations-analysis/index + tests), performance-hub (types/analysis/service/index/hub-labels/hub-view/hub-print/sections + analysis tests), kpi-reporting (index/insights), i18n (dynamic-labels/presentation/en-map), quality routes (`complaints`, `quality`), `reports/run`, `evidence-storage`, evidence-routes test, kpi-reports UI (KpiReportsPage/control-bar/view-state/kpi-reports-shared/insights-labels), print-adapters, hooks (use-kpi-queries), smart-quality + hr-decision test fixtures, `page.tsx`, `permissions.ts`, `types/index.ts`.

**New (12):** `lib/performance-hub/group-report.ts` + test; `lib/kpi-reporting/flexible-period.ts` + test; `lib/kpi-reporting/flexible-insights.ts` + test; `lib/i18n/__tests__/dynamic-labels-coverage.test.ts`; `api/performance-hub/group/route.ts`; `api/kpi-reports/insights-flexible/route.ts`; `PerformanceHubGroupPage.tsx`; `FlexiblePeriodPicker.tsx`; `FlexibleReportView.tsx`.

### E.2 Test results

| Suite | Result |
|---|---|
| performance-hub analysis (+ 4 new §METRIC-VALIDATION tests) | 30/30 ✔ |
| performance-intelligence (+ 3 new dataset tests) | 31/31 ✔ |
| group-report contract | 4/4 ✔ |
| flexible-period + flexible-insights | 25/25 ✔ |
| i18n coverage + presentation-boundary + i18n-boundary | 52/52 ✔ |
| hr-decision + smart-quality-report fixtures | ✔ |
| evidence-routes (was broken file-level) | **12/12 ✔ (repaired)** |
| **FULL suite** | **3,069 tests — 3,060 pass / 9 fail; every failure verified pre-existing on the pristine baseline (git stash A/B comparison); ZERO new failures** |

**Pre-existing failures honestly documented (not caused by this phase; each verified identical on the stashed baseline):** evidence-items storage-path parsing (2), quality-observations evidence UI regressions (4 — ObservationDetailDialog evidence section), global-search highlight-integration (1), find-user-by-email.mts (1), download-opt/notification-stats POLL-tier (1 — needs a live Firebase env). Three PRE-EXISTING failures were FIXED by this phase: hub analysis doctrine tests `1e` (all-empty overview) and `8a` (zero-noise changes) — brought in line with the module's own documented spec — plus the evidence-routes harness (wrong support-module path + a Windows path bug that prevented the file from ever running; now 12/12).

### E.3 TypeScript

**`npx tsc --noEmit`: 0 errors** (baseline was 15 errors across `complaints/route`, `quality/route`, `reports/run/route`, `kpi-reports-shared`, `workspace.test`, `evidence-storage`, `evidence-routes.test`, `en-map` duplicates). All fixed with explicit narrowing/typing — **no `any`, no `@ts-ignore`, no disabled checks**:
- Route body fields narrowed with explicit `typeof` guards (non-strings rejected 400, never coerced).
- Created records typed `{ id: string; approvalStatus: string }` intersections instead of bare `Record<string, unknown>` reads.
- `evidence-storage` sweep: `GetFilesOptions.maxResults` (the installed API surface) instead of the non-existent `pageSize`.
- `evidence-routes.test`: correct `../../__tests__/m01-test-support` path + Node-canonical `fileURLToPath` (the manual `pathname` surgery produced `file:\C:\…` on Windows) — the test now RUNS and PASSES 12/12.

### E.4 ESLint

`npx eslint` clean (0 errors, 0 warnings) on all 30+ touched files, including the new group/flexible modules and pages.

### E.5 Production build

Production build verified on the final code: **exit 0** — `✓ Compiled successfully in 22.5s`, all **102 static pages** generated (`next build` with `BUILD_DIST_DIR` isolation; a plain `npm run build` additionally needs the locally-locked `.next/standalone` freed — a live server on port 3000 holds that handle, which is the exact scenario the project's `BUILD_DIST_DIR` escape hatch documents; the first full `npm run build` of this phase also completed exit 0 end-to-end before the lock appeared).

### E.6 Remaining limitations

1. The 9 pre-existing baseline test failures listed in E.2 (not regressions; each individually verified identical on the pristine baseline — mostly requiring live Firebase or the pre-existing evidence path-parser semantics).
2. Customer & Deal Follow-up remains **NOT_MEASURABLE by design** until a dedicated follow-up source (tasks/deadlines/contact timestamps/history) is introduced — the single point of change is `assessCustomerFollowUpMeasurability()`.
3. Excel export for flexible periods goes through the flexible JSON endpoint's consumer (the `kpi-monthly` registry export remains month-keyed — printed output covers flexible periods; a dedicated flexible Excel runner is a follow-up item, not silently mixed).
4. The AOCC `customer_follow_up` decision label (complaint-driven) is untouched — it is a complaint-response concept, distinct from both metrics.

### Regression protection (§7)

Single-employee Hub, Executive Overview, dimensions, pattern detection, evidence navigation, KPI Reports monthly scope, MTD/LIVE/FINALIZED behavior, org-tree boundaries, server-side authorization, AR-RTL/EN-LTR, print/export — all intact (full-suite A/B proves zero regressions; the monthly flow is byte-identical when no flexible period is selected).
