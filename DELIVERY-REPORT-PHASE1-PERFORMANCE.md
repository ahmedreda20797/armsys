# QNALYS — Phase 1: Performance & Scalability — Delivery Report

**Date:** 2026-11-17 · **Scope:** Tasks A–F of the Phase 1 implementation plan
**Status:** Implemented, tested, awaiting owner review. No commits, no deploys, no Firebase Console changes.

---

## A. Executive Summary

Phase 1 delivered measurable read-path scalability for the Performance Hub and group reports, in-flight request deduplication at the database layer, and a typed API error contract — with **zero change to KPI formulas, risk scoring, snapshot semantics, permissions, or scope enforcement**.

| Result | Detail |
|---|---|
| Group report DB ops (50 members) | **6,950 → 5,625 (−1,325; −19.1%)** — employees point reads **950 → 0**, HR full-table reads **50 → 1** |
| Group report DB ops (10 members) | 1,390 → 1,145 (−245; −17.6%) |
| DB layer | §SINGLE-FLIGHT in-flight dedup for `getAll` / `getAllBatch` / `getById`; TTL cache policy unchanged |
| API error contract | Arabic-substring error classification replaced by typed `FlexiblePeriodValidationError` with 7 stable codes |
| Security | 30 new route-level security tests pass; **2 latent bugs found and fixed** (empty-population 500; org-subtree resolution always resolving zero members) |
| Verification | `tsc --noEmit` clean · ESLint clean on all changed files · full suite **3,187 tests, 9 pre-existing failures (none caused by Phase 1)** · production build succeeds |

---

## B. Implemented Changes

### Task A — Database read deduplication (`src/lib/db.ts`)

**What was wrong.** `getAll` on a cold TTL cache issued one full-table RTDB download per caller — N concurrent identical reads downloaded the same table N times. `getById` point reads had no sharing at all (relevant to the ~2–3 uncached employees point reads per hub dataset build).

**What was changed.** A `singleFlight(key, run)` registry: concurrent identical reads share one pending RTDB operation.

- Keys include every result-affecting parameter: `all:<table>:<ttl>` for `getAll`/`getAllBatch` (the TTL selects the cache entry the winner stores), `byId:<table>:<id>` for `getById`.
- `getAllBatch` routes per-table reads through the same registry, so a batch table and a concurrent `getAll` of the same table share one download.
- Cleanup runs on **both** outcomes (`.finally`): rejected flights are removed immediately (the next caller retries fresh) and completed flights never linger (`getInFlightReadCount()` is exposed for diagnostics).
- **Not a cache:** no entry survives the operation's settlement; the TTL policy (5s/15s/30s/60s/POLL) is byte-for-byte unchanged.
- **Scope honesty:** this deduplicates within one server instance only — it is *not* distributed deduplication across Vercel instances (documented in the module header).
- Mutable-sharing surface unchanged: the cached path already returned the same array reference to every caller; the flight winner's result flows into that same cache. No new sharing was introduced.

**Why it is safe.** No user/scope parameter exists at this layer (whole-table reads are identical for every caller); `findUserByEmail` still bypasses the cache deliberately; empty-table reads still return `[]` uncached; batch failure semantics (first rejection rejects the batch) are preserved.

**Tests:** `src/lib/__tests__/db-single-flight.test.mts` — 14 tests (concurrent sharing, distinct keys/TTLs, rejection cleanup + retry, registry drainage, getById dedup/retry/freshness, batch+getAll flight sharing, batch failure propagation, empty-table behavior, data isolation).

### Task B — HR deductions read optimization (`src/lib/hr-deductions/lookup.ts` + hub service)

**What was wrong.** The Performance Hub's HR block read the **whole `hrDeductions` table and re-scanned it per employee** (`performance-hub/service.ts` used to `getAll(HR_DEDUCTIONS_TABLE)` then filter per employee). In a group report with `hrAuthorized`, that meant one full-table read+scan per member (50 members → 50 reads, ~O(N×M) row visits).

**What was changed.**
- New `src/lib/hr-deductions/lookup.ts`: `buildHrDeductionLookup(rows)` (pure — groups raw rows into an employee → month index) and `loadHrDeductionLookup()` (one cached collection read, grouped once).
- `getEmployeePerformanceHubDataset` accepts an optional `hrLookup` input; when omitted it loads its own (identical behavior for the single-employee route). The group builder loads **one** lookup per request and passes it to every member.
- The lookup is request-scoped (held in a local variable, never global/TTL state) — permission-sensitive HR rows cannot leak across requests or viewers. It returns **raw rows grouped by reference**: no status/archived/eligibility filtering, no reordering, no dedup — every consumer keeps its existing gate (the Hub counts all statuses with a per-status breakdown; insights applies `isEffectiveHrDeduction` elsewhere, untouched).

**Why it is safe.** Proven equivalent: `lookup.forEmployeeMonth(id, month)` is asserted deep-equal to the exact legacy filter (`rows.filter(r => r.employeeId === id).filter(r => r.month === month)`) across representative datasets; missing month data stays `null` (never zero-filled); rows without `employeeId` can never match a query (they couldn't before either); aggregation semantics untouched (`aggregateHrMonth` verbatim).

**Tests:** `src/lib/performance-hub/__tests__/hr-lookup.test.ts` — 11 tests (legacy-filter equivalence, order preservation, no duplicates, scope isolation between employees, month boundaries, null-not-zero missing data, unauthorized path reads nothing, statusCounts incl. pending).

### Task C — Group performance scalability (`group-report.ts` + `scoped-loaders.ts` + hub service)

**What was wrong.**
1. `buildPerformanceGroupReport` fanned out up to 50 `getEmployeePerformanceHubDataset` builds through an **unbounded `Promise.all`** (8 tables × 50 members × 2 months of engine work launched in one turn), and any single member's rejection failed the whole request with a 500 — while the contract already promised `failedEmployeeIds` for member-level failures.
2. Through the default loaders each member paid ~**19 uncached employees point reads** (`getById('employees')` from identity ×3, KPI record ×2, engine employee ×2 per member-month) plus repeated org-node mapping.

**What was changed.**
- **Bounded pool** (`GROUP_BUILD_CONCURRENCY = 8`): `mapWithConcurrency` keeps all workers busy with index-based result collection — deterministic ordering, per-member failure capture, no unbounded fan-out.
- **Explicit partial failure:** a member whose build rejects lands in `failedEmployeeIds` + a `failedDatasets:` data-quality note (the documented contract). A **systemic** failure (every member rejects) rethrows — a broken database still surfaces as a 500, not an empty-looking report.
- **Request-scoped loaders** (`createRequestScopedHubLoaders()`): the employees table is read **once** per request and projected per id through the canonical projections (`toIdentityRecord`, `loadEmployees()`'s org-label resolution, the engine's `toFrameworkEmployee`) — zero projection drift; `loadOrgNodes` is loaded/mapped once. The hub service accepts an optional `loaders` input (default unchanged).
- **One shared §HR-LOOKUP** per request (Task B).

**Data-freshness tradeoff (documented):** identity/record reads move from uncached point reads to the `TTL.MEDIUM`-cached employees read — the *same* read the population resolution already used, so the whole report now sees one consistent employees snapshot per request (staleness ≤ 15s inside one request instead of mixing fresh point reads with a cached list).

**Two latent bugs found & fixed** (both pre-existing in the working tree, exposed by the new route tests):

::code-comment{title="[P1] Empty population crashes the group report" body="dimensionRollups dereferenced datasets[0]! unconditionally; a selection narrowed entirely out of scope (e.g. a manager requesting only an out-of-scope org node) threw TypeError and returned HTTP 500. Guarded behind a datasets.length check — an empty population now yields an empty rollups list." file="C:\\Users\\Target\\Desktop\\arm-erp-project\\src\\lib\\performance-hub\\group-report.ts" priority=1}

::code-comment{title="[P1] Org-node subtree resolution always resolved zero members" body="subtreeEmployees was computed as subtreeIds(...).filter(id => employeeById.has(id)) — subtreeIds returns ORG NODE ids, filtered against EMPLOYEE ids, so the set was always empty. Every org-node selection silently produced an empty population and out-of-scope nodes were never flagged (0===0). Replaced with the canonical employeeIdsInSubtree over groupEmployeesByNode — the same primitives the scope engine uses; the documented partial-coverage fail-closed rule now actually computes on real employee ids." file="C:\\Users\\Target\\Desktop\\arm-erp-project\\src\\lib\\performance-hub\\group-report.ts" priority=1}

**Preserved verbatim:** canonical builders, employee scope + subtree coverage (fail-closed on partial visibility), section gates, `NOT_MEASURABLE` / `INSUFFICIENT_DATA` / `PENDING` states, output ordering, the hard 50-member cap with explicit truncation. Caching beyond the existing lib/db TTL was **not** added.

**Tests:** `src/lib/performance-hub/__tests__/group-scalability.test.ts` — 10 tests: complete reports at **1 / 10 / 25 / 50** members with deterministic ordering and no fabricated values; measured before/after read counts (old path re-materialized verbatim in-test); shared-lookup output parity; individual-failure surfacing; systemic-failure rethrow; scope narrowing.

### Task D — API error contracts (`flexible-period.ts` + insights-flexible route)

**What was wrong.** `insights-flexible/route.ts` classified builder failures by matching **Arabic message substrings** (`message.includes('متداخلتان') || …`) — fragile against copy changes and structurally indistinguishable from a genuine server error with similar wording.

**What was changed.**
- `FlexiblePeriodErrorCode` — 7 stable codes: `INVALID_DAY_KEY`, `INVALID_MONTH_KEY`, `INVALID_YEAR`, `INVALID_RANGE_ORDER`, `EXCEEDS_MAX_SPAN`, `UNKNOWN_KIND`, `PERIOD_OVERLAP`.
- Every failure branch in `resolveFlexiblePeriod` / `resolvePeriodWithComparison` now carries its `code` alongside the unchanged Arabic message (additive field — the pre-existing 23 flexible-period tests pass untouched).
- `buildFlexibleKpiInsights` throws `FlexiblePeriodValidationError(code, message)`; the route classifies via `isFlexiblePeriodValidationError` (structural: `instanceof` **plus** a `name`+`code` plain-object check for cross-bundle safety) and returns the **same 400 shape** with the Arabic message intact and the stable code in `error.details.periodErrorCode`. Everything else → 500 (unchanged envelope, no internals leaked).
- HTTP status codes and response shapes are unchanged; clients no longer depend on Arabic text for classification; frontend display is unaffected (messages identical).

**Tests:** `insights-flexible-errors.test.ts` — 10 tests: every failure branch's code; the overlap code; classifier (incl. a plain `Error` with the same Arabic text correctly NOT classified); the real route handler: 401 / 403 / 400×4 with stable envelope / typed code in details / 500 with no internal leak; source-level assertion that no Arabic substring matching remains.

### Task E — Group API route security tests (`performance-hub-group-route.test.ts`)

30 tests exercising the **real** `POST /api/performance-hub/group` handler through the in-memory harness (no parallel authorization implementation):

- **Employee scope:** manager subtree allow-path; out-of-scope employee id rejected from the report and surfaced in `outOfScopeEmployeeIds` (never widened, never leaked); fully out-of-scope node rejected; **partial subtree coverage fails closed** (a partially-visible `dept_sales` node contributes nothing from either team); serialized-response scans prove no unauthorized id/name/HR-row appears.
- **Permissions:** 401 without token; 403 with `employee360` denied (stable shape, no employee data in the error body); **section-level enforcement proven at the I/O level** — with the `hrDeductions` section denied, the `hrDeductions` table is **never even read** and the `hr` dimension is absent; admin bypass resolves unrestricted exactly where intended (M0.5).
- **Request validation:** 14 malformed-request cases (missing/invalid month, non-array/non-string/empty/over-length ids, empty selection, >100 ids, invalid limit ×3, non-object body ×2) → stable 400 `VALIDATION` envelope with no report data; duplicate ids deduplicate; unknown node ids surface as out-of-scope; over-cap limit clamps.
- **Response behavior:** canonical error shape asserted (`{ code, message, details, validation }`); leak scans on success and failure paths.

### Task F — Indexed queries: investigation only

Delivered as [INDEXED-QUERIES-PHASE2-RECOMMENDATIONS.md](INDEXED-QUERIES-PHASE2-RECOMMENDATIONS.md). No schema change, no rules deployment, no query replacement. Highlights: `database.rules.json` currently has **zero** `.indexOn` entries; the login indexed query is already coded but blocked on rules + the documented network hang (breaker + scan fallback exist); a prioritized rules-only index plan (inert until queries adopt them, zero regression risk from adding) and a separate-phase plan for per-employee subcollections, with compatibility and migration risks documented.

---

## C. Files Changed

### Modified by Phase 1 (11 files edited, of which 3 are new modules)

| File | Change |
|---|---|
| `src/lib/db.ts` | §SINGLE-FLIGHT registry + `getAll`/`getAllBatch`/`getById` rewiring + `getInFlightReadCount()` |
| `src/lib/hr-deductions/lookup.ts` *(new)* | `buildHrDeductionLookup` (pure) + `loadHrDeductionLookup` |
| `src/lib/performance-hub/service.ts`† | optional `hrLookup` + `loaders` inputs; HR block through the lookup |
| `src/lib/performance-hub/group-report.ts`† | bounded pool, per-member failure capture, shared lookup/loaders, **2 latent-bug fixes** |
| `src/lib/performance-hub/scoped-loaders.ts` *(new)* | `createRequestScopedHubLoaders()` |
| `src/lib/performance-hub/index.ts` | barrel: `GROUP_BUILD_CONCURRENCY`, `createRequestScopedHubLoaders` |
| `src/lib/performance-intelligence/loaders.ts` | `toIdentityRecord` exported (pure projection, reused by scoped loaders) |
| `src/lib/performance-intelligence/index.ts` | barrel: `toIdentityRecord` |
| `src/lib/kpi-framework/employee-result.ts` | `toFrameworkEmployee` exported (projection reused verbatim) |
| `src/lib/kpi-reporting/flexible-period.ts`† | typed `FlexiblePeriodValidationError` + 7 stable codes on all failure branches |
| `src/lib/kpi-reporting/flexible-insights.ts`† | throws the typed validation error |
| `src/lib/kpi-reporting/index.ts` | barrel: error class + classifier + code type |
| `src/app/api/kpi-reports/insights-flexible/route.ts`† | structural classification replaces Arabic substring matching; code in `details` |
| `INDEXED-QUERIES-PHASE2-RECOMMENDATIONS.md` *(new)* | Task F investigation |

† These files are part of the user's pre-existing uncommitted work (tracked-modified or untracked-new); Phase 1 edits were applied **additively on top** — no user content altered or discarded.

### Newly created test files (5)

`src/lib/__tests__/db-single-flight.test.mts` · `src/lib/performance-hub/__tests__/hr-lookup.test.ts` · `src/lib/performance-hub/__tests__/group-scalability.test.ts` · `src/app/api/kpi-reports/__tests__/insights-flexible-errors.test.ts` · `src/lib/__tests__/performance-hub-group-route.test.ts`

### Pre-existing user modifications (untouched)

All files listed as modified/untracked in the session-start git status (e.g. `firebase.json`, `src/config/permissions.ts`, `src/lib/metrics/kpiMetrics.ts`, `src/lib/evidence-storage.ts`, the `performance-hub` UI components, `quality-kpi` pages, i18n maps, the untracked `group-report.ts`/`flexible-*.ts`/group route/`PerformanceHubGroupPage.tsx`, …) remain exactly as the user left them, except where explicitly listed above. **No reset, clean, stash, overwrite, or discard was performed.** (`next-env.d.ts`/`tsconfig.json` were auto-touched by the isolated build and restored to their HEAD state — net zero.)

---

## D. Performance Results

Measured through the in-memory db harness (every stubbed `getAll`/`getById` logged), old path re-materialized verbatim (default loaders + per-member HR read + unbounded fan-out) vs. the new builder — same fixtures, same request:

| Group size | Path | DB operations | employees point reads | HR full-table reads |
|---|---|---|---|---|
| 10 | BEFORE | 1,390 | 190 | 10 |
| 10 | AFTER | **1,145** (−245, −17.6%) | **0** | **1** |
| 50 | BEFORE | 6,950 | 950 | 50 |
| 50 | AFTER | **5,625** (−1,325, −19.1%) | **0** | **1** |

- Stubbed-run wall time (n=50): 312ms → 114ms — **informational only** (in-memory stubs).
- **Production RTDB latency: not measured** — this environment has no live database timing; the numbers above are operation *counts*, which translate to round-trip savings proportional to RTDB latency.
- Remaining per-member operations (~112/member) are whole-table reads that production additionally dedups through the TTL cache + §SINGLE-FLIGHT — the loader-level test harness has no TTL, so these counts measure loader behavior exactly.
- Output identity: member rows from the old path and the new builder are asserted equal (Task C parity test); HR blocks asserted deep-equal with and without the shared lookup (Task B test 7).
- Single-employee Hub route: read *count* unchanged (1 HR read either way); the win there is §SINGLE-FLIGHT dedup of concurrent identical reads.
- Limitation: no CPU-time profiling was done; the bounded pool's benefit is bounded memory/connection pressure, not throughput.

## E. Security and Data Integrity

- **Authorization & scope:** untouched paths — the group route still runs `requireAuth → verifyPermission('employee360','view') → resolveEmployeeScopeFromDb → section gates` before any data read; selection narrowing, fail-closed partial-subtree coverage, and section gates are now pinned by 30 route-level tests (including I/O-level proof that a denied HR section reads nothing). The subtree-resolution bug fix makes the *documented* fail-closed rule actually computable — it moves behavior from "silently empty" to "correctly resolved and scope-intersected", never wider than the authorized scope.
- **KPI consistency:** no formula, engine, or scoring file was altered. The engine's `toFrameworkEmployee` and the intelligence layer's `toIdentityRecord` are exported pure projections, reused verbatim — zero second implementation. All 189 KPI/reporting/engine tests and the 23 flexible-period tests pass unchanged.
- **Snapshots & periods:** frozen-month semantics, flexible reporting periods, and `loadMonthDetail`'s closed-vs-live orchestration are untouched; flexible-period failures are now typed but produce identical HTTP responses and Arabic messages.
- **HR data:** the request-scoped lookup holds HR rows only for the duration of one request in a caller-held local; no global or TTL state for permission-sensitive data; status/eligibility gates unchanged.

## F. Test Results (exact commands and actual results)

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0** (clean) |
| `npx eslint <18 changed files>` | **0 errors, 0 warnings** |
| `node --experimental-test-module-mocks --import tsx --test src/lib/__tests__/db-single-flight.test.mts` | 14/14 pass |
| `npx tsx --test src/lib/performance-hub/__tests__/hr-lookup.test.ts` | 11/11 pass |
| `npx tsx --test src/lib/performance-hub/__tests__/group-scalability.test.ts` | 10/10 pass |
| `npx tsx --test src/app/api/kpi-reports/__tests__/insights-flexible-errors.test.ts` | 10/10 pass |
| `npx tsx --test src/lib/__tests__/performance-hub-group-route.test.ts` | 30/30 pass |
| Focused existing: flexible-insights + group-report + analysis + performance-intelligence + kpiMetrics | 189/189 pass |
| Focused existing: insights route + m02 + m021 + route-auth + m05-scoped-reads + hr-decision-routes + m03-org-scope | 130/130 pass |
| `npx tsx --test src/lib/kpi-reporting/__tests__/flexible-period.test.ts` | 23/23 pass |
| `npm test` (full suite) | **TS batch: 3,129 tests — 3,122 pass / 7 fail · MTS batch: 60 tests — 58 pass / 2 fail** |
| `BUILD_DIST_DIR=.next-phase1-build npx next build` | **exit 0** — production build succeeds (isolated dist dir; temp dir removed afterwards) |

**The 9 failures — all pre-existing, none caused by Phase 1 (verified, not assumed):**

1. `download-opt-route-contracts.test.mts` "stats contract unchanged…" — fixture stamps the rule log `'2026-09-19'` and asserts it happened *today*; only passed while the clock was 2026-09-19 (today is 2026-11-17). Date-dependent baseline failure; the file fully mocks `@/lib/db`, so Phase 1 code never executes in it.
2. `find-user-by-email.test.mts` — loads the real `db.ts`, which trips the `server-only` package under standalone tsx (the runner's tsconfig mapping never reaches the ESM batch — verified by exact replication before triage). Baseline.
3–4. `evidence-items.test.ts` ×2 (`parseEvidenceStoragePath` traversal, provenance stamping) — pure evidence-storage logic; `evidence-storage.ts` carries **pre-existing user modifications**; not in any Phase 1 import graph.
5. `global-search.test.ts` "highlight integration" — expects `useRecordHighlight(` in `EmployeesPage.tsx` source; the component doesn't contain it (test/source drift). No Phase 1 file involved.
6–9. `smart-quality-report-ui.test.ts` ×4 (ObservationDetailDialog evidence-section UI regressions) — source-expectation drift on dialog components; that test file and the dialog are pre-existing user modifications; not in any Phase 1 import graph.

None of the 9 failing files import a module Phase 1 modified (the one shared module, `performance-intelligence`, is imported **type-only** in the UI test — erased at runtime).

## G. Known Limitations

- **Single-instance dedup only** — §SINGLE-FLIGHT does not deduplicate across Vercel instances.
- **Production latency not benchmarked** — no live RTDB in this environment; improvements are proven by operation counts and output identity, not wall-clock production numbers.
- **Caching beyond the existing TTL was deliberately not added** for group reports — the TTL + single-flight + request-scoped sharing cover the request path; cross-request caching of user-influenced reports would need invalidation proofs Phase 1 does not claim.
- **MTS-batch baseline failures** (server-only tripwire under standalone tsx) affect 2 pre-existing ESM suites; fixing the test runner's tsconfig flag placement is out of scope (test-infrastructure, unrelated to Phase 1 goals).
- The 9 pre-existing failures listed above were **not** fixed (per instructions — unrelated to Phase 1).
- `revokeAllUserRefreshTokens` still runs an unguarded indexed query (documented in Task F, recommended as Phase 2 step 3).

## H. Recommended Next Steps

1. **Deploy the `.indexOn` rules** from [INDEXED-QUERIES-PHASE2-RECOMMENDATIONS.md](INDEXED-QUERIES-PHASE2-RECOMMENDATIONS.md) (owner approval required — touches Firebase configuration), then let the already-coded login indexed query go primary.
2. **Guard `revokeAllUserRefreshTokens`** with the `raceWithTimeout` + fallback pattern.
3. **Fix the runner's mts tsconfig placement** so the 2 baseline-failing ESM suites (incl. the login-lookup suite guarding the breaker) actually execute in CI.
4. **Adopt indexed per-employee reads** for `attendanceResults`/`qualityObservations` behind the timeout+fallback pattern (Phase 2 steps 4–5).
5. **Fix the 4 UI-regression + 1 highlight source-drift tests** (component work owned by the user's in-progress changes) and the date-dependent download-opt fixture (use a clock-relative timestamp).
6. **Consider request-scoped `loadOrgIndex` memoization** inside `resolveReportEmployeeDepartments` (per-call org index rebuilds remain the largest CPU slice of the group build).

## I. Git Working Tree

- **Modified by Phase 1:** the 10 tracked files + 3 user-owned untracked files listed in section C (all additive).
- **Pre-existing user modifications:** every file in the session-start git status is preserved as-is apart from section C (original snapshot captured before any Phase 1 edit; truncated at `?? QNALYS-COMPLETION…` at session start).
- **Newly created by Phase 1:** 5 test files + `INDEXED-QUERIES-PHASE2-RECOMMENDATIONS.md` + `DELIVERY-REPORT-PHASE1-PERFORMANCE.md`.
- **No commits made. No deploys. No Firebase Console or rules changes. No destructive migrations. Nothing stashed, reset, or discarded.**

*Awaiting owner review.*
