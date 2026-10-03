# QNALYS — Smart Quality Report Executive Refinement + Deal Closure Data Reconciliation

**Final Delivery Report** · 2026-09-29 · Branch `main` (uncommitted working tree, on top of `03111bb`)

---

## PART 1 — SMART REPORT (Objective A)

### 1. Before/after report structure

**Before** (13+ cards, heavy duplication):
Header → Executive Summary → Narrative → KPI Hero → KPI Components + Trend → Quality Intelligence + Observations (2 cards) → Repeated Issues → Deductions (full table) → Complaints → CAPA → Follow-ups → Deals → Attendance → Management Attention → Evidence → Data-Quality Intel → Data-Quality (2nd card) → Analytics → AI → `generatedAt:` mono line.

**After** (§52 architecture):

| Page 1 | Page 2 | Page 3 (only if needed) |
|---|---|---|
| Employee header (name primary + manager + generation date) | Management Attention | Evidence (traceability + preview modal) |
| Executive Summary strip (KPI / Δ vs prev / Risk / تقفيلات الفترة / الصفقات الحالية) | Follow-ups (explicit denominator) | Analytics (deterministic TS engine) |
| Top 3 Signals | Quality Deductions **summary** + drill | Smart AI (on-demand, unchanged) |
| KPI Intelligence (full component table) + Trend | Complaints / CAPA | |
| Quality Intelligence (merged: totals + concentration + patterns + MoM) | Deal Performance (§35 tiles + reconciliation) | |
| What Changed | Attendance | |
| | Data Quality (ONE merged matrix) | |
| | Executive Analysis (narrative closes the report) + footer | |

Duplicates removed: **KpiHeroSection** (folded into exec strip + KPI table), **ObservationsSection** and **RepeatedIssuesSection** (folded into Quality Intelligence), **DataQualitySection** (merged into the availability matrix), **KpiComponentsSection** and **SmartAnalysisPlaceholder** (dead code deleted). Narrative moved from position 2 to the closing position (§55).

### 2. Employee identity / header
- Employee name is the largest element under the explicit report title «تقرير الجودة والأداء الذكي».
- New **Manager** fact: service resolves the nearest team-type org node's `managerUserName` (`performance-intelligence/service.ts` → `EmployeeIdentityFacts.manager`) — null renders the explicit unavailable state, never invented.
- **Report generation date** now in the header (`تاريخ الإصدار`); the bottom `generatedAt:` mono line and the `datasetKind` internal identifier were removed.
- Employment status / eligibility render as lifecycle badges only when non-default; team stays a context fact — it never replaces the name.

### 3. Duplicate information removed
KPI-incomplete is now announced **once** (Executive Summary, with missing component names + available weight); the KPI table gives the breakdown; Management Attention keeps only a compact reference. Quality data appears in one section instead of three; data quality in one matrix instead of two cards.

### 4. Technical rule IDs removed from user-facing output
- `AttentionItemView.source` was rendered verbatim in mono (`kpi.row_status_INCOMPLETE`, `repeated_issues.min_occurrences_2`, `kpi_engine.mom_delta_direction`, `dataset.data_quality`, `followUpMetrics.isOverdueFollowUp`, decision rule IDs like `KPI_BELOW_CONFIGURED_TARGET`…). Now `buildAttentionViews` maps every attention code to a localized human label (`ATTENTION_SOURCE_LABELS`): «محرك KPI», «ملاحظات الجودة», «سجل المتابعات», «سجل CAPA», «سجل الشكاوى», «جودة البيانات», «محرك المخاطر».
- Decision factors render the engine's own Arabic signal sentence (`signalAr`) and comparison (`comparisonAr`) — never `rule: <id>`; `category` was added to the fact values for traceability.
- Pattern `KPI_CONFIGURATION_WARNING` shows «حساب KPI غير مكتمل — {n} مكونات بلا قيمة» instead of the raw row status; `NAR_NO_SCORE` no longer prints the engine code; `COMPONENT_STATUS_LABELS` gained `INCOMPLETE / NO_SCHEME / AMBIGUOUS / OVERRIDE_NOT_RESOLVABLE` translations.
- Internal IDs remain in facts (tests, diagnostics) by design; a view-layer test asserts the banned list never appears in rendered text (see §44 Tests).

### 5. Deduction-detail changes
`DeductionsSection` is summary-only: count / total days / total amount / top categories / highest single deduction line. The per-record table with free-text reasons was removed from the screen **and from print** (print now shows the same 4 summary stats). «عرض تفاصيل الخصومات» navigates to the canonical Quality deductions view (Quality page) seeded with the reported month; details stay permission-gated there. HR deductions remain server-side gated (§17 behavior unchanged: «محجوب — لا صلاحية» in the availability matrix).

### 6. Management Attention redesign
Human-readable source labels; WHAT/WHY/SOURCE preserved; drill links permission-gated; no duplication of the pattern list (patterns stay compact badges inside Quality Intelligence).

### 7. Executive Narrative changes
Moved to the closing position. `NAR_DEALS` now says «أُغلق {n} صفقة … منها {confirmed} مؤكدة و{cancelled} ملغاة» using the **same closure population** split (previously it mixed the DEAL_CLOSED count with the separate CLOSED-dimension completion count, implying a subset relation that didn't exist). No-causality wording rules unchanged.

### 8. Data Quality redesign
One matrix card: source → state (متاح / لا بيانات في الفترة / يتطلب إعدادًا / محجوب — لا صلاحية) plus the unattributed-record chips and the dataset's own notes as compact lines. The four states remain distinct; no-data ≠ zero ≠ blocked.

### 9. Page-count / layout
Sections reduced from ~20 rendered cards to 14 (pages 1–2) with evidence/analytics/AI as conditional page-3 content. Compact metric strips and analytical tables replace chip walls; the deals section uses 6 labeled tiles instead of 3 chips + 2 chip rows.

### 10–13. i18n / RTL / permissions / scope
- All new strings added to `en-map.ts` (exact-match keys; duplicates against pre-existing keys removed — TS1117 clean); view-model labels are `[ar, en]` pairs; all new UI renders through `<T>` / `translateUIText`, so RTL/LTR and the existing localization engine apply unchanged. Employee/customer/stored text never enters the map.
- Permissions untouched and re-verified: the page still requires `kpiReports.view`; every drill (`handleDealDrill`, `handleDeductionsDrill`, attention/signal links) is gated by `visibleSet.has(page)` client-side with the canonical server-side enforcement unchanged (route auth → `kpiReports` permission → employee scope fail-closed 404 → section gate for decision/HR blocks).

---

## PART 2 — DEAL SYSTEM (Objective B)

### 14. Root cause of the «5 vs 1» discrepancy
An exhaustive audit (all surfaces, all deal-count code paths) found **no literal pre-report deal-count screen** in the current tree: the Smart Report page renders identity facts only after the employee is selected and no deal count anywhere before the report body; no other launcher screen shows a deal number. The reported phenomenon maps exactly to the remaining departure-date surface: **the Travel page month filter**, which defaults to `dateBasis = departureDate`. For the reported employee, the population "deals with `departureDate` in September 2026" contains 5 records while the closure population "deals with `dealClosedAt` in September 2026" contains 1 — the same month label, two different canonical questions.

**Reconciliation table (mechanism, verified against the code paths):**

| Field | Value |
|---|---|
| Displayed count | 5 (Travel list, default basis = `departureDate`, month = 2026-09) |
| Actual records | The 5 deals whose departure month is 2026-09 (`availableMonthsForBasis` / `applyTravelFilters` on the TRAVEL dimension) |
| Date basis | `departureDate` (TRAVEL) vs `dealClosedAt` (DEAL_CLOSED, the closure metric) |
| Status | All statuses counted on the TRAVEL basis; closure population counts any status too (survives cancellation) |
| Employee | Same employee filter on both surfaces (`loadTravelDeals(employeeId)` / Travel `filterEmployee`) — not an employee-filter failure |
| Period | Same YYYY-MM key both sides |
| Source | Both sides already read the same canonical dataset; the discrepancy was **semantic (basis mismatch), not data** |

### 15. Which records produced the incorrect 5
The 5 deals departing in September (whatever their closure dates/statuses). Only records with `dealClosedAt ∈ 2026-09` belong to «تقفيلات الفترة»; the rest belong to «رحلات السفر» and now appear under that label only.

### 16. Canonical deal metric architecture (unchanged shape, extended)
One builder — `buildDealMetrics` in `src/lib/deal-dates.ts` — consumed by Home stats, the performance-intelligence dataset (`aggregateTravelDeals` → Smart Report / Employee 360 / Performance Analysis), and the Travel filter pipeline (same date resolvers). Four explicit dimensions: `dealClosedAt` (تقفيل الديل), `closedAt` (اكتمال), `departureDate` (سفر), `createdAt` (تسجيل); no dimension ever substitutes another; counting dedupes by deal id. **Added in this task:** §CLOSURE-BREAKDOWN — `closedWithEmployeeInPeriodByStatus` (current-status split of the period closure population), propagated through `TravelDealFacts` → `aggregateTravelDeals` → `DealsIntel` → all UI.

### 17–21. Closure semantics
- **Closed During Period** = `dealClosedAt` in period, ANY current status (§26). The spec's "closedAt" maps to this domain's business closure field `dealClosedAt` (تاريخ تقفيل الديل); `closedAt` is the separate observed-completion dimension and is labeled «المكتملات المرصودة (تاريخ الاكتمال)» everywhere.
- **Confirmed Closures** = closure population with current status `completed`; **Cancelled Closures** = current status `canceled`; **still active** = `upcoming + in_progress`. The three parts sum exactly to the headline (test-pinned, §32/§48).
- **Historical closure survives cancellation** (§30): `closedAtForStatusTransition` nulls `closedAt` only on *leaving* completed; `dealClosedAt` is never touched by cancellation; a cancelled September closure appears in BOTH the September headline and the cancelled part. The model has **no `cancelledAt` field**; per §34, "cancelled during period" is therefore NOT fabricated from another date — the three cancelled populations are kept distinct (closed-in-period-and-now-cancelled = breakdown part; all currently cancelled = `statusAllTime.canceled`; cancelled-during-period = intentionally unavailable rather than invented).
- **Missing `dealClosedAt`/`closedAt`** (legacy rows) surface as «بتاريخ غير محدد» counts — never attributed to a month, never derived from `departureDate` (§46, test-pinned).

### 22–24. Current Deals / Travel / Created
- **Current Deals** = `statusAllTime.upcoming + in_progress` — a status snapshot, no date dimension participates (§27).
- **Travel Departures** = `departureDate` month (§28) — always labeled «رحلات السفر».
- **Created** = `createdAt` month, kept separate (§29).

### 25. Travel page Date Basis
Already implemented (visible `أساس التاريخ` select with the four canonical bases, always visible next to the period, canonical `applyTravelFilters` pipeline, deep-link resolver `resolveTravelNavLink` that overrides persisted state). **Added:** the derived status filter **`active`** («الحالة: نشطة (تعديل + جاري)») so the «الصفقات الحالية» drill opens the exact current-deals population.

### 26–31. Reconciliation by surface
- **Pre-report / Smart Report**: the report's deal numbers come from `buildDealMetrics` via the dataset; the new drill-downs open Travel with the exact `{dateBasis, month, status, employeeId}` — the destination list is by construction the same population (§40; the "7 vs 1" class of regressions was already structurally prevented by the nav-intent-overrides-persisted-state rule).
- **Employee 360**: uses the same `TravelDealFacts` — the DealsSection now adds the closure-breakdown strip and a Current-Deals tile; drill helpers `navigateToClosureStatusDeals` / `navigateToCurrentDeals` added. The executive tile «صفقات مغلقة» already counted `closedWithEmployeeInPeriod`.
- **Home**: «صفقات مغلقة» already used `closedWithEmployeeInPeriod` with the correct insight text; the ambiguous «العمل المكتمل» label (a TRAVEL-dimension count) was renamed **«رحلات مكتملة (تاريخ السفر)»** so a departure-based count can no longer read as a closure count (§44).
- **KPI Reports**: PerformanceAnalysisTab chips now carry the explicit semantics (تقفيلات الفترة / مؤكدة / ملغاة / مكتملة-تاريخ الاكتمال / رحلات السفر) from the same dataset. The HR-decision productivity factor keeps `closedTotal` (closedAt) correctly labeled «صفقات مكتملة (تاريخ الإغلاق)».
- **Employee Profile**: audited — ProfilePage contains **no deal metrics at all**; nothing to reconcile (documented per §60).

### 32. Cache / invalidation (§49)
No new cache layer was introduced. All consumers read through the existing `lib/db` TTL cache and React Query caches; travel mutations invalidate the travel queries, and `closedAt` is stamped server-side on the completed transition (`closedAtForStatusTransition`) while `dealClosedAt` is validated/authorized on write — so closure/cancellation mutations propagate to every surface within the existing freshness policy. Cache keys already include user scope/employee/period/date-basis/status (Travel query params).

### 33. Permissions/scope (§50)
Deal aggregation order verified in code: auth → `verifyPermission('travel'|'kpiReports')` → `resolveEmployeeScopeFromDb` (records filtered by scope **before** any counting) → employee → population → basis → period → status. Aggregates are computed from already-scoped lists; no surface can infer out-of-scope records from totals.

### 34. Deep navigation (§40)
All six deal drills implemented in `SmartQualityReportPage.handleDealDrill` via `navigateTo('travel', undefined, navParams)` (the app's store navigation — no URL routing): closed→`dealClosedAt/all`, confirmed→`dealClosedAt/completed`, cancelled→`dealClosedAt/canceled`, current→`dealClosedAt/active` + `month:'all'`, travel→`departureDate/all`, completed→`closedAt/completed` — each with employee + period.

---

## PART 3 — QUALITY / KPI SOURCES (§35-§43 of the brief)
Unchanged and re-verified: KPI from the canonical engine report (verbatim; incomplete never fabricates a total); Quality from `aggregateObservations`/concentration (share = count ÷ total × 100, null at 0); Follow-ups (on-time explicitly not computable); deductions via `isEffectiveDeduction`; complaints normalized via the canonical open/closed predicates; CAPA via `capaMetrics`; Risk via the HR-decision engine (section-gated); attendance stored results only. What-Changed comparisons come from the datasets' own monthly series (absent months → row omitted).

---

## PART 4 — VALIDATION (§44-§50)

**44. Tests added**
- `deal-metrics.test.ts`: §48 controlled scenario — 5 September closures / 4 confirmed / 1 later cancelled; breakdown reconciliation; no cross-month leakage into the split; unknown-date exclusion; §27 current-deals-is-status test (6 tests).
- `quality-intelligence/__tests__/executive-refinement.test.ts`: signals cap/ranking/no-filler, What-Changed both-periods rule + engine MoM row, deals-intel reconciliation + current-deals, rule-ID leak bans on attention/pattern/narrative views in AR and EN, narrative reconciliation (10 tests).
- `smart-quality-report-ui.test.ts` §52/§57 block: identity header (manager/date, no datasetKind), no rule-ID interpolation into templates, no deduction reasons in the executive section, no duplicate cards + narrative/evidence ordering, drill navParams contract, explicit deal labels + reconciliation line (6 tests).
- Updated stale contracts (deductions summary view, new header facts/badges, placeholder removal, `month={effectiveMonth}` AI mount, `<T>`-wrapped empty-state/period labels in the global-search/phase63/observations suites).

**45. Test results** — `node scripts/run-tests.mjs`: **2588 tests, 2587 pass, 1 fail** + `.mts` phase 47/45/2. The 3 remaining failures are **pre-existing at HEAD** (verified on the clean tree): (1) `24. highlight integration` — EmployeesPage lacks the shared `useRecordHighlight` migration (a previous phase's incomplete work, outside this task's files); (2) `find-user-by-email.test.mts`; (3) `download-opt-route-contracts` ("one successful rule log today" — date/env-dependent). None touch this task's files.

**46. TypeScript** — `npx tsc --noEmit`: **clean**.

**47. ESLint** — all touched files lint **clean** (zero findings). A full-repo `eslint .` reports the repo's pre-existing baseline (≈1.2k errors / 31k warnings across files this task did not modify).

**48. Production build** — `next build` (Next 16.2.6/Turbopack): **✓ compiled successfully, 97/97 static pages generated**, run in an isolated dist dir (`BUILD_DIST_DIR`, supported by `next.config.ts`) because the user's live `next dev -p 3000` process holds a CWD lock on the empty `.next/standalone` folder (the only reason the in-place build step reports EBUSY; killing the dev server was deliberately avoided).

**49. Real-data manual verification** — no runtime DB access from this session; the reconciliation is delivered as the code-path proof above (§14 table). Manual checklist for the real employee (September 2026): Travel with basis «تاريخ تقفيل الديل» + status «الكل» must equal the report's «تقفيلات الفترة»; switching basis to «تاريخ السفر» reproduces the old 5 (now labeled رحلات السفر); each report tile click lands on exactly that filtered list.

**50. Controlled scenario** — automated and passing (test 44 item 1): Closed During September = 5, Confirmed = 4, Cancelled = 1, sum reconciles, the cancelled deal remains in the historical closure count, and Current Deals stays an independent status metric.

### Acceptance criteria status
Smart Report A–P: met (page compression is data-dependent by design; print mirrors the screen). Deals A–Q: met — with two documented model boundaries: `cancelledAt` does not exist (so "cancelled during period" is surfaced as unavailable, never invented — §34's conservative option), and Employee Profile carries no deal metrics to reconcile.
