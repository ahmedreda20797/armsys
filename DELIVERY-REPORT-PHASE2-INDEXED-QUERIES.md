# QNALYS — Phase 2: Indexed Queries & Database Optimization — Delivery Report

**Date:** 2026-11-17 · **Scope:** Tasks A–F of the Phase 2 mandate (input: [DELIVERY-REPORT-PHASE1-PERFORMANCE.md](DELIVERY-REPORT-PHASE1-PERFORMANCE.md) + [INDEXED-QUERIES-PHASE2-RECOMMENDATIONS.md](INDEXED-QUERIES-PHASE2-RECOMMENDATIONS.md))
**Status:** Implemented, tested, awaiting owner review. **No commits, no deploys, no Firebase Rules publication, no production data touched.**

---

## 1. Executive Summary

Phase 2 converts the Phase 1 investigation into a working **guarded indexed-query layer** and adopts it at every read path where completeness is provable: the login lookup's index is unlocked by rules, the unguarded session-revocation query is protected, and the two P1 growth tables (`attendanceResults`, `qualityObservations`) plus four per-employee operational tables now fetch **only the rows they need**, with a correctness-preserving full-scan fallback behind every indexed attempt.

| Result | Detail |
|---|---|
| New DB primitive | `getAllByChildEqualTo(table, field, value)` in `src/lib/db.ts` — indexed attempt + hard timeout + transparent full-scan fallback + per-target circuit breaker + single-flight dedup + TTL cache with write-invalidation |
| Task A | `revokeAllUserRefreshTokens` no longer runs an unguarded `orderByChild('userId')` — timeout/breaker/fallback/dedup/explicit-failure guard; **a timeout can never surface as a successful revocation** |
| Task B | `findUserByEmail` verified (no code change needed); duplicate/inconsistent-email cases now covered by executable tests |
| Tasks C/D | 9 adoption sites across `attendanceResults` (4) and `qualityObservations` (5) — every one proven result-identical by legacy re-materialization **and** forced-fallback double-run parity tests |
| Task E | 8 new `.indexOn` declarations in `database.rules.json` — purely additive; every read/write denial byte-identical to the approved Phase 0 baseline |
| Task F | Per-employee reads for `followUps` / `travelDeals` / `complaints` / `hrDeductions` indexed; `capaCases` (array membership) and `notifications` (Phase 0 visibility model) deliberately NOT indexed — documented |
| Verification | `tsc --noEmit` clean · ESLint 0/0 on all 17 linted files (of 18 touched — `database.rules.json` is JSON, not lintable) · **65/65 new tests pass** · focused regression re-runs **605/605** (7 listed suites) plus **18/18** employee-360 view-model · full suite **3,254 tests — 9 failures, all pre-existing Phase 1 baseline** · production build exit 0 (isolated dist dir, auto-generated files restored) |

**Deployment state of the optimization:** the code works **before** the rules are published — a missing index fails FAST ("index not defined"), the fallback serves the exact legacy result, and fast errors never open the breaker. Publishing the rules (owner action, section 12) is what unlocks the actual savings; until then each adopted read pays one extra fast failed query per cold read (bounded; the result is still cached for the TTL window).

---

## 2. Task Status

| Task | Status | Notes |
|---|---|---|
| A — Protect `revokeAllUserRefreshTokens` | **Completed** | Timeout + breaker + fallback + orphan handling (late results ignored, late rejections swallowed — see section 5) + concurrent-dedup + explicit failure. 15 tests. |
| B — Optimize/verify `findUserByEmail` | **Completed (verification only)** | Architecture already correct (indexed + timeout + fallback + breaker). Zero code changes; 7 new tests for the previously-uncovered duplicate/inconsistent-email + breaker-open cases (the pre-existing suite does not load under the current ESM runner — baseline failure). |
| C — `attendanceResults` indexed queries | **Completed (4 of 6 read sites adopted)** | Month reads (2) + per-employee reads (2) indexed; team-benchmark full read and the point-read `getAttendanceResult` deliberately unchanged (section 8). |
| D — `qualityObservations` indexed queries | **Completed (5 sites adopted)** | Month reads (3) + per-employee reads (2). List route, repetition-alerts, AI tool kept on cached full reads (section 8). |
| E — Additive `.indexOn` declarations | **Completed** | 8 declarations, each justified by an adopted query; publication deferred to the owner. |
| F — Other high-cost tables | **Partially completed, rest deliberately deferred** | `followUps`/`travelDeals`/`complaints`/`hrDeductions` per-employee loaders adopted; `capaCases` and `notifications` documented as unsafe/unnecessary this phase (section 8). |

---

## 3. Modified and Newly Created Files

### Modified for Phase 2 (11 source files — 10 lintable TS + `database.rules.json` — plus 2 test-infrastructure files = 18 files touched)

| File | Change |
|---|---|
| `src/lib/db.ts` | §INDEXED-QUERY section: `getAllByChildEqualTo` + breaker/diagnostics/test hooks; `invalidateCache(table)` now also clears `idx:<table>:*` entries |
| `src/lib/auth.ts` | §SESSION-REVOKE-GUARD: `revokeAllUserRefreshTokens` rewritten behind `loadUserSessionIds` (indexed attempt + scan fallback) with module-level breaker, in-flight dedup, orphan handling; `resetSessionRevokeStateForTests` test hook. **No authentication/session contract changed** |
| `src/lib/attendance/monthly-results.ts` | Generation path + `getAttendanceResultsForMonth` → indexed `month` fetch |
| `src/lib/employee-performance/index.ts` | `loadAttendanceResults` / `loadHrDeductions` → indexed `employeeId` fetch |
| `src/lib/performance-intelligence/loaders.ts` | `loadObservationsForWindow` / `loadStoredAttendanceResult` / `loadFollowUps` / `loadTravelDeals` / `loadComplaints` → indexed `employeeId` fetch |
| `src/lib/kpi-reporting/loaders.ts` | `loadObservations(monthKey)` → indexed `month` fetch |
| `src/lib/kpi-framework/employee-result.ts` | `lookupQualityScore` live path → indexed `employeeId` fetch (single-employee pipeline only) |
| `src/lib/month-snapshots.ts` | `computeFreshMonthSnapshot` → indexed `month` fetch |
| `src/lib/reports/runners/kpi-master-employee.ts` | Scoring-observations read → indexed `month` fetch |
| `src/app/api/employee-360/[id]/route.ts` | HR-deductions read → indexed `employeeId` fetch |
| `database.rules.json` | 8 additive `.indexOn` declarations (section 6); all `.read`/`.write` denials untouched |
| `src/lib/__tests__/m01-test-support.ts` | Test-infra only: the db stub gains an in-memory `getAllByChildEqualTo` (the `{ ...realDb }` spread otherwise leaks the REAL function, which closes over real Firebase) |
| `src/lib/performance-hub/__tests__/group-scalability.test.ts` | The two failure-injection tests now inject on `getAllByChildEqualTo` (the read function the per-member observation read actually uses) — same tested contract |

† Files carrying pre-existing user modifications (`employee-result.ts`, `performance-intelligence/loaders.ts`, `employee-360` route, etc.) were edited **additively** — no user content altered or discarded.

### Newly created test files (5)

| File | Tests |
|---|---|
| `src/lib/__tests__/indexed-query-primitive.test.mts` | 17 — primitive semantics, fallback, breaker, single-flight, delayed orphans, cache/invalidation |
| `src/lib/__tests__/revoke-session-guard.test.mts` | 15 — all Task A behaviors + sessions measurement |
| `src/lib/__tests__/find-user-by-email-phase2.test.mts` | 7 — Task B duplicates/inconsistency/breaker-open coverage |
| `src/lib/__tests__/phase2-query-parity.test.mts` | 20 — old≡new parity for every adopted reader + 4 measurement scenarios |
| `src/lib/__tests__/phase2-index-declarations.test.ts` | 6 — rules additivity/no-grant/no-capaCases-index assertions |

---

## 4. Every Adopted Indexed Query

All adopted queries go through the same guarded primitive (`getAllByChildEqualTo`): **hard timeout (10s default) → any failure (missing index / timeout / network error) → legacy full-scan fallback** (the exact pre-Phase-2 computation), with a per-`table.field` circuit breaker (2 consecutive *timeouts* → 5-minute cooldown; fast errors and successes never open it; success resets it), single-flight dedup of concurrent identical queries, explicit draining of the orphaned original query, and TTL-cached results invalidated together with the table.

| # | Table.field | Query | Adopted at (call site) | Fallback (the correctness baseline) |
|---|---|---|---|---|
| 1 | `users.email` | `orderByChild('email').equalTo(email).limitToFirst(2)` | `findUserByEmail` (pre-existing code; activated by the rules) | full-scan with normalized-email equality (unchanged) |
| 2 | `sessions.userId` | `orderByChild('userId').equalTo(userId)` | `revokeAllUserRefreshTokens` (Task A) | full-node scan + strict `userId` equality → same multi-path null-update |
| 3 | `attendanceResults.month` | `equalTo(monthKey)` | `getAttendanceResultsForMonth` · `generateMonthlyAttendanceResults` (existing-results read) | full read + `r.month === monthKey` |
| 4 | `attendanceResults.employeeId` | `equalTo(employeeId)` | `defaultEmployeePerformanceLoaders.loadAttendanceResults` · `defaultPerformanceIntelligenceLoaders.loadStoredAttendanceResult` | full read + strict filter (last-wins preserved — ties come back in key order, identical to a full-table scan) |
| 5 | `qualityObservations.month` | `equalTo(monthKey)` | `defaultKpiReportingLoaders.loadObservations` · `computeFreshMonthSnapshot` · `kpi-master-employee` runner | full read + strict stored-month filter |
| 6 | `qualityObservations.employeeId` | `equalTo(employeeId)` | `defaultPerformanceIntelligenceLoaders.loadObservationsForWindow` · `lookupQualityScore` live path | full read + the identical two-condition filter |
| 7 | `followUps.employeeId` | `equalTo(employeeId)` | `defaultPerformanceIntelligenceLoaders.loadFollowUps` | full read + strict filter |
| 8 | `travelDeals.employeeId` | `equalTo(employeeId)` | `defaultPerformanceIntelligenceLoaders.loadTravelDeals` | full read + strict filter |
| 9 | `complaints.employeeId` | `equalTo(employeeId)` | `defaultPerformanceIntelligenceLoaders.loadComplaints` | full read + strict filter |
| 10 | `hrDeductions.employeeId` | `equalTo(employeeId)` | `defaultEmployeePerformanceLoaders.loadHrDeductions` · employee-360 route | full read + strict filter |

**Why the predicates are provably equal:** RTDB `equalTo(v)` matches exactly the records whose child value equals `v` (records *without* the child never match an `orderByChild` query), and the legacy in-memory filters are strict `===` on the same fields — missing/`null`/`undefined` values match neither path. Ordering: an `equalTo` result returns its ties in key order — the same relative order a full-table scan produced — so "last row wins" consumers (`loadStoredAttendanceResult`) select the same record. `loadObservationsForWindow` intentionally queries by **employeeId, never month**: its month matching is the canonical `attributeMonth` policy (stored month → observation date → ISO), which can attribute rows whose *stored* month is missing — a month-indexed query would drop them (pinned by a dedicated parity test).

---

## 5. Timeout / Fallback / Circuit-Breaker Behavior (shared contract)

- **Timeout** — every indexed attempt is raced against a hard cap (10s default; per-call override in tests). A timeout is **never** treated as an empty dataset and **never** as success: the fallback scan runs and only its result is used.
- **Firebase error** (missing index, permission shape, network reset) — same fallback; fast errors do **not** count toward the breaker (they are not the hang signature).
- **Empty result** — a legitimate miss (e.g., an employee with no records) returns `[]` and is cached; both paths agree (parity-tested).
- **Circuit breaker** — per `table.field` target. 2 consecutive timeouts open it for 5 minutes; while open, the scan serves directly (`path: 'scan-breaker-open'` diagnostic). First indexed success resets the streak; breakers are independent per target.
- **Delayed original queries** — `Promise.race` cannot cancel the losing RTDB query: the Firebase Admin SDK exposes **no cancellation** for an in-flight `.get()`, so the orphan keeps running on the RTDB connection until it settles on its own or the transport drops it. "Drained" means precisely and only: the orphan's late **resolution is ignored** (nothing reads it — it can never reach a caller or the cache) and its late **rejection is swallowed** (a reaction is attached to the original promise, so it can never surface as an unhandled rejection). Both guarantees are test-pinned (the delayed-resolve and never-settling-hang tests). A **never-settling** query retains its pending promise plus one outstanding request on the shared RTDB connection for the process/connection lifetime — not preventable client-side, and bounded in accumulation by the per-target breaker (≤2 consecutive hangs per target before the indexed path is skipped for the cooldown window).
- **Duplicate concurrent requests** — the whole operation (query + fallback) runs under the §SINGLE-FLIGHT registry keyed `idxq:table:field:value`: N concurrent identical callers share ONE attempt and ONE fallback. Task A additionally dedups concurrent revocations per userId and frees the slot on failure so the next caller retries fresh.
- **Fallback failure** — if BOTH the indexed query and the scan fail, the operation **rejects**. A broken database surfaces as an error, never as silently-empty data. In Task A this means the password-change flow returns 500 instead of reporting success while sessions survive.
- **Fallback scan is NOT timeout-capped** — the correctness fallback is the proven full-node `.get()`, which (like `findUserByEmail`'s `findWhere` fallback, the in-repo precedent this phase deliberately follows) carries no client-side timeout; a hung scan would hang the caller. Documented trade-off of reusing the proven path (see section 11, limitation 6).
- **Cache** — indexed results cached under `idx:<table>:<field>:<value>` with the caller's TTL tier; `invalidateCache(table)` clears them together with the table cache, so a write is visible to indexed readers on the next read (the same guarantee the table cache has always had). No new authorization surface: the cached rows are the same shared whole-table rows the legacy cache already held process-wide; authorization still happens downstream at the caller.

---

## 6. New Firebase Rules Declarations (Task E)

`database.rules.json` — the ONLY change is `.indexOn` arrays under `arm_erp/*`:

| Path | `.indexOn` | Justifies |
|---|---|---|
| `arm_erp/users` | `["email"]` | `findUserByEmail` (query already coded) |
| `arm_erp/sessions` | `["userId"]` | Task A session revocation |
| `arm_erp/attendanceResults` | `["employeeId", "month"]` | Task C month + per-employee reads |
| `arm_erp/qualityObservations` | `["employeeId", "month"]` | Task D month + per-employee reads |
| `arm_erp/followUps` | `["employeeId"]` | Task F per-employee read |
| `arm_erp/travelDeals` | `["employeeId"]` | Task F per-employee read |
| `arm_erp/complaints` | `["employeeId"]` | Task F per-employee read |
| `arm_erp/hrDeductions` | `["employeeId"]` | Task F per-employee reads |

**Candidates deliberately NOT added** (avoid unnecessary indexes):
- `capaCases.relatedEmployeeIds` — **RTDB has no array-contains semantics**; `orderByChild('relatedEmployeeIds').equalTo(empId)` does not express "element ∈ array", and the primary+indirect split still needs the full scan for the array half, so the index would buy nothing. Future alternative (documented, NOT implemented): a denormalized membership map (`capaMembers/<employeeId>/<caseId>`) maintained on write — requires collection restructuring, deferred to a separate phase per the mandate.
- `capaCases.employeeId` — no adopted query; the reader needs the array half anyway.
- `notifications.userId` / `notifications.createdAt` — the notification list route must evaluate the whole visible-candidate set (broadcast + directed + permission-gated visibility, Phase 0's approved model) before narrowing; a per-user index cannot express that predicate, and reworking it is explicitly out of scope. The §DOWNLOAD-OPT TTL already bounds poll cost.
- `hrDeductions.month` — no month-only query was adopted for this table (the §HR-LOOKUP reads the whole table per request by design, Phase 1 architecture).
- `attendanceResults.month` **was** added (unlike hrDeductions) because two adopted queries filter by month.

**Security preservation (asserted by 6 tests + the existing Phase 0 suite):** root and `arm_erp` `.read`/`.write` remain `false`; `erp/notifications` remains deny-all; the cascade-aware grant walk finds **zero** read grants and **zero** write grants anywhere; the Phase 0 baseline nodes are byte-identical.

---

## 7. Old-vs-New Query Parity Results

Two independent methods per reader (all in `phase2-query-parity.test.mts`, 20/20 pass):

- **Method A — legacy re-materialization:** the exact pre-Phase-2 computation re-implemented in the test and compared **deep-equal (order included)** against the new reader.
- **Method B — forced-fallback double-run:** the shipped reader run twice against identical fixtures — once with the fake index working, once with the index forced to fail (the fallback path IS the legacy computation shipped in production code).

| Reader | Method A | Method B | Hazards covered by the fixture |
|---|---|---|---|
| `getAttendanceResultsForMonth` | ✅ | ✅ | missing `employeeId`, missing `month`, out-of-scope employee, duplicate (employee, month), unknown fields, empty month |
| `generateMonthlyAttendanceResults` (create + regenerate paths) | — | ✅ (summary + persisted rows + audit entries identical) | deterministic ids converge; regeneration updates, never duplicates |
| `loadStoredAttendanceResult` | ✅ (last-wins) | ✅ | duplicate keys under different record ids |
| `loadAttendanceResults` (employee-performance) | ✅ | ✅ | cross-employee leakage asserted absent on both paths |
| `loadObservations` (kpi-reporting) | ✅ | ✅ | rows without a stored month never match (both paths) |
| `loadObservationsForWindow` | ✅ | ✅ | **legacy row with missing stored month attributed via observationDate is retained** — the reason this read queries by employeeId, not month |
| `loadLiveQualityScore` | ✅ (identical score/points/count) | ✅ | open-month live engine path |
| `computeFreshMonthSnapshot` | — | ✅ (whole engine payload identical modulo the wall-clock `generatedAt` stamp) | snapshot completeness incl. unattributed/`undefined`-keyed rows preserved |
| `loadFollowUps` / `loadTravelDeals` / `loadComplaints` / `loadHrDeductions` | ✅ | ✅ | pending HR rows survive untouched; empty-employee `[]` on both paths; zero-fill impossible |

Leak-shape test: for five adopted per-employee readers, **no other employee's row is ever returned**, on the indexed path or the fallback. Records with missing identifiers, unexpected structures, and out-of-scope employees are exercised in the shared fixture.

---

## 8. Deliberately NOT Indexed (completeness-first decisions)

| Read path | Decision | Reason |
|---|---|---|
| Team benchmark (hub service): full `attendanceResults` / `travelDeals` / `followUps` read | **kept full** | One read serves ALL N members through the TTL cache + single-flight — N indexed queries would *increase* op count for no byte win beyond what one shared download already costs |
| §HR-LOOKUP (`hr-deductions/lookup.ts`) | **kept full** | Phase 1 architecture: one request-scoped read + in-memory grouping serves single- and group- flows; reworking it is out of scope |
| Interactive list routes (`quality-observations`, `follow-ups`, `travel`, `complaints`, `hr-deductions` GET) | **kept full (cached)** | Scope-first (M0.5) filtering over many optional filters; indexed reads only help when an employeeId param is present; these routes are TTL-cached + single-flight. Deferred with rationale (conditional read paths in authorization-sensitive routes need their own parity harness) |
| `repetition-alerts` route | **kept full** | Cross-employee repetition detection needs the whole scope's rows anyway |
| AI tool `getQualityObservations` | **kept full** | Scope-first over all employees in the caller's scope |
| `month-snapshots` rebuild-all route | **kept full** | Reads ALL months' observations — a full read is the correct shape |
| `capaCases` | **not indexed** | Array-membership half is unindexable in RTDB (section 6); primary-only indexing buys nothing |
| `notifications` | **not indexed** | Phase 0 visibility model (broadcast + directed + permission gates) requires the candidate set; already bounded by §DOWNLOAD-OPT TTL + single-flight |
| `getAttendanceResult(month, employeeId)` | **already optimal** | Deterministic id `${month}_${employeeId}` → `getById` point read |

**Tradeoff documented:** in multi-employee request paths (e.g., a group report), per-member indexed reads trade MORE round trips for FEWER bytes. RTDB bills bandwidth, so byte reduction is the cost win; op-count changes are reported honestly in section 9. Single-employee paths (the dominant report/360 flows) reduce both.

---

## 9. Performance Measurements

**Methodology:** in-memory RTDB harness (the same doctrine as the Phase 1 read-count measurements) counting RTDB operations and **rows downloaded per read** (the RTDB-billed quantity) on a COLD cache. Fixtures: 12 employees × 12 months (144 attendance rows, 288 observations + edge rows), 120 users, 200 sessions across 20 users. Executed by the measurement tests in `phase2-query-parity.test.mts` + `revoke-session-guard.test.mts` — **these are mock/harness measurements of operation and row counts, not production timings.** No production RTDB exists in this environment; production latency/bandwidth was NOT measured and is not claimed.

| Database path | Reads before | Reads after | Rows downloaded before → after (harness fixture) |
|---|---|---|---|
| `attendanceResults` — month read (`getAttendanceResultsForMonth`, generation existing-results read) | 1 full-table read | 1 indexed query | **144 → 12 rows (−91.7%)** |
| `qualityObservations` — month read (`loadObservations`, snapshot pipeline, master-employee runner) | 1 full-table read | 1 indexed query | **288 → 24 rows (−91.7%)** |
| Single-employee bundle (`loadObservationsForWindow` + `loadFollowUps` + `loadHrDeductions` + `loadAttendanceResults`) | 4 full-table reads | 4 indexed queries (op count equal) | **456 → 38 rows (−91.7%)** |
| `users.email` (login lookup) | 1 full-table scan | 1 indexed query (`limitToFirst(2)`) | **120 → 1 row (−99.2%)** |
| `sessions.userId` (revocation lookup) | 1 full-table scan | 1 indexed query | **200 → 10 rows (−95.0%)** |

Scaling note: the per-month/per-employee savings are **proportional to table growth** — `attendanceResults` grows one row per employee per month, `qualityObservations` per observation; a workforce of E with M months of history downloads E×M rows today per cold month-read and M→1 employee's rows after. The table-level caches (§TTL) and §SINGLE-FLIGHT from Phase 1 continue to bound *repeat* reads; this phase bounds the *per-download cost* exactly as the Phase 1 investigation recommended.

---

## 10. Exact Test Results

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0** (clean) |
| `npx eslint` — 3 invocations covering all 17 linted files: (1) 10 source files + `phase2-index-declarations.test.ts`, (2) the 4 new `.mts` suites, (3) the 2 test-infrastructure files. The 18th touched file (`database.rules.json`) is JSON and not lintable | **0 errors, 0 warnings** |
| `node --experimental-test-module-mocks --import tsx --test src/lib/__tests__/indexed-query-primitive.test.mts` | **17/17 pass** (reproduced in the post-delivery audit) |
| `node --experimental-test-module-mocks --import tsx --test src/lib/__tests__/revoke-session-guard.test.mts` | **15/15 pass** (reproduced) |
| `node --experimental-test-module-mocks --import tsx --test src/lib/__tests__/find-user-by-email-phase2.test.mts` | **7/7 pass** (reproduced) |
| `node --experimental-test-module-mocks --import tsx --test src/lib/__tests__/phase2-query-parity.test.mts` | **20/20 pass** (reproduced) |
| `npx tsx --tsconfig tsconfig.test.json --test src/lib/__tests__/phase2-index-declarations.test.ts` | **6/6 pass** (reproduced) |
| Focused regression: attendance (monthly-results/kpi/report-compat) | **47/47 pass** (reproduced) |
| Focused regression: kpi-framework + kpi-reporting + insights + kpi-reporting view-model | **103/103 pass** (reproduced) |
| Focused regression: performance-hub (analysis/group-scalability/hr-lookup) + performance-intelligence + group route | **112/112 pass** (reproduced) |
| Focused regression: phase0-security-reliability + m05-scoped-reads + m03-org-scope + m04-scoped-writes | **214/214 pass** (reproduced) |
| Focused regression: month-snapshots + month-discovery + employee-performance | **87/87 pass** (reproduced) |
| Focused regression: employee-360 view-model (run separately) | **18/18 pass** |
| Focused regression: follow-ups period + route-auth + m02 + m021 (4 files) | **19/19 pass** (reproduced) — `login-route-errors.test.mts` was NOT in this run: the original invocation pointed at a nonexistent `.ts` path and tsx only logs "Could not find" without failing the run. It passes **10/10** under the correct ESM runner (verified in the post-delivery audit) and is part of the full-suite MTS batch |
| Focused regression: reports suite | **23/23 pass** (reproduced) |

**Focused-regression accounting (post-delivery audit):** the seven listed suites sum to **605/605** (47+103+112+214+87+19+23); adding the separately-run employee-360 view-model suite gives **623/623** executed-and-passed focused regression tests. No test FILE appears in two focused suites (disjoint file sets verified). These focused runs are a SUBSET of the full suite's files re-run in isolation — they are **not additive** to the full-suite total. (An earlier draft of this report stated "505/505" — an arithmetic error, corrected here.)

| `npm test` (full suite) | **TS batch: 3,135 tests — 3,128 pass / 7 fail · MTS batch: 119 tests — 117 pass / 2 fail** |
| `BUILD_DIST_DIR=.next-phase2-build npx next build` | **exit 0** — production build succeeds (isolated dist dir, removed afterwards; the build's auto-touch of `next-env.d.ts`/`tsconfig.json` was restored to HEAD — net zero, same as Phase 1) |

**The 9 failures — all pre-existing Phase 1 baseline. Evidence, verified in the post-delivery audit (not assumed):**

**Count cross-check:** Phase 1's execution record: TS 3,129 / MTS 60. This phase added exactly 6 TS-batch tests (rules suite) and 59 MTS-batch tests (17+15+7+20): 3,129+6 = 3,135 and 60+59 = 119 — the full-suite totals are exactly Phase 1's plus the new tests, i.e. **zero test-count change to any existing suite**, and the failure count is 9 in both phases.

1. `find-user-by-email.test.mts` — fails **at file load** (`server-only` tripwire under the standalone ESM runner; the file does not neutralize the package — documented Phase 1 baseline; it never executes). Its semantics are re-established executably in `find-user-by-email-phase2.test.mts` (7/7 pass).
2. `download-opt-route-contracts.test.mts` "stats contract unchanged + both reads use the POLL tier" — date-dependent fixture (stamps `2026-09-19` as "today"; today is 2026-11-17). Phase 1 baseline.
3–4. `evidence/__tests__/evidence-items.test.ts` ×2 ("parseEvidenceStoragePath", "sanitizeEvidenceItems") — pure-logic tests ("Pure imports only — no db, no HTTP, no Firebase") over the **user-modified** `evidence-storage.ts` (pre-existing working-tree change, not Phase 2's).
5–8. `quality-observations/__tests__/evidence.test.ts` ×4 ("ObservationDetailDialog renders a dedicated evidence section", "all three evidence actions present with Arabic labels", "empty evidence state label rendered", "external links open safely (noopener noreferrer)") — **source-introspection tests**: `readFileSync` of `src/components/pages/quality-kpi/ObservationsPage.tsx` asserting Arabic label strings. The component is tracked and clean (unmodified by Phase 2 or the user); Phase 2 touched no UI component, so these failures cannot be Phase 2-caused. *Attribution correction:* Phase 1's report listed these 4 under `smart-quality-report-ui.test.ts`; the test names exist **only** in `quality-observations/__tests__/evidence.test.ts` (verified by grep; `smart-quality-report-ui.test.ts` — user-modified — contains none of them). The failure set is the same; the file attribution in the Phase 1 report (inherited here) was wrong.
9. `global-search.test.ts` "highlight integration" — expects `useRecordHighlight(` in `src/components/pages/EmployeesPage.tsx` (source introspection via fs); the component is tracked and clean. Phase 1 baseline.

**New failures caused by Phase 2: none.**

---

## 11. Remaining Risks and Limitations

1. **Rules publication gates the savings.** Until the owner publishes section 6's declarations, every adopted read pays one extra fast failed query (then falls back — the result is TTL-cached, so repeats don't re-pay). Results are identical throughout; only the cost changes.
2. **Harness measurements only.** All numbers are mock/harness op + row counts (section 9). Production RTDB latency/bandwidth was not measurable here.
3. **Op-vs-bytes tradeoff in group paths** (section 8): per-member indexed reads increase round-trip count where one shared full download used to serve N members; the team-benchmark and §HR-LOOKUP paths were deliberately left on the shared full read.
4. **Breaker cooldowns are per server instance** (module-level state, like the login breaker) — a Vercel instance that never sees a timeout never skips; one that does skips for 5 minutes even if the network recovered mid-cooldown (first success resets immediately after the cooldown).
5. **Indexed-result TTL cache** shares the table cache's invalidation contract; a write path that bypasses `db.ts` helpers (direct `getAdminDb` writes) would leave both caches equally stale — no new staleness class was introduced (same as the pre-existing whole-table cache).
6. **Fallback scans and hung queries are not client-side cancellable.** The timeout caps only the indexed ATTEMPT; the correctness fallback (full-node `.get()`, in both the primitive and Task A) carries no timeout — the deliberate reuse of the path proven to work (`findUserByEmail`'s fallback is uncapped too). Likewise, an indexed query that loses the timeout race cannot be cancelled (no Admin SDK cancellation): it stays an outstanding request on the shared RTDB connection until it settles or the transport drops it, retaining a pending promise + attached reactions locally. Accumulation of such orphans is bounded by the per-target breaker (≤2 consecutive timeouts per target before the indexed path is skipped for the 5-minute cooldown); per hung query the retained local state is one pending promise and closure — negligible memory, one outstanding connection-level request.
7. The 9 pre-existing baseline failures were not fixed (per instructions — unrelated to Phase 2).

## 12. New Firebase Rules Declarations Requiring MANUAL Publication

The 8 `.indexOn` declarations in section 6 are **in the repository file only**. Per the mandate, **the rules were NOT published** — the owner should review and publish them (Firebase Console → Realtime Database → Rules, or `firebase deploy --only database`). Both publication orders are safe: the code falls back correctly before publication and uses the index after. No read/write permission changes accompany them.

## 13. Phase 0 Security Preservation — Explicit Confirmation

- The published Phase 0 security configuration was treated as the approved baseline; **no security rule, permission, or notification-architecture change was made**.
- `database.rules.json`: only `.indexOn` arrays were added; a cascade-aware walk proves **zero** `.read`/`.write` grants exist anywhere; `erp/notifications` remains deny-all; all pre-existing denials are byte-identical (6 new rules tests + the unmodified Phase 0 suite, 214/214, pass).
- **No direct browser-to-RTDB access was introduced** — every new query runs server-side through the Firebase Admin SDK via `db.ts`/`auth.ts`.
- Indexed queries are **not** an authorization mechanism: every consumer keeps its existing server-side scope/permission filtering (M0.5), proven unchanged by the m05/m03/m04 suites (214 tests), the group-route security tests, and the leak-shape parity test.
- No employee or organization data leakage path was added: indexed results carry the same rows the legacy whole-table reads already produced, filtered downstream exactly as before.

## 14. Final Confirmations

- ✅ No application deployment occurred (the verification build used an isolated dist dir and was removed; auto-generated files restored).
- ✅ No Firebase Rules were published.
- ✅ No production data was modified (no live database access at all — all testing against in-memory fakes).
- ✅ No destructive migration, no backfill, no collection restructuring, no field renaming occurred.
- ✅ No Git commit was created; no reset/stash/checkout/discard of user changes was performed (the only `git checkout` restored the two files the build itself auto-touched, back to their pre-build HEAD state).
- ✅ All user uncommitted/untracked work preserved (verified against the session-start status).

*Awaiting the project owner's review. Phase 3 not started.*

---

## 15. Post-Delivery Verification Audit (2026-11-17)

A discrepancy investigation was performed against the actual execution records and source code. No application code, test, or configuration file was modified during the audit — **only this report was corrected**. Findings, with evidence and severity:

### F1 — Focused-regression total misstated as "505/505" — *documentation error, corrected*

The listed suites sum to **605** (47+103+112+214+87+19+23), and a separately-run employee-360 view-model suite (18/18) was originally unlisted — the accurate total of executed-and-passed focused regression tests is **623**. Every suite was re-run during the audit and reproduced its count exactly (47/103/112/214/87/19/23 + 18). No test file appears in two focused suites (disjoint file sets verified); the focused runs are a subset of the full suite's files re-run in isolation and are not additive to the full-suite total. Severity: LOW (report accuracy only). Corrected in sections 1 and 10.

### F2 — ESLint scope stated inconsistently ("15" vs "17 touched") — *documentation error, corrected*

Verified scope: **three** ESLint invocations covering **17 lintable files** — (1) 10 source files + `phase2-index-declarations.test.ts`, (2) the 4 new `.mts` suites, (3) `m01-test-support.ts` + `group-scalability.test.ts` — all 0 errors/0 warnings. 18 files were touched in total; the 18th (`database.rules.json`) is JSON and not lintable, so lint coverage of lintable touched files is **complete** — there is no lint coverage gap. Severity: LOW (report accuracy only). Corrected in sections 1 and 10.

### F3 — Focused route-regression run silently omitted `login-route-errors` — *test-execution hygiene finding*

The original invocation passed `src/lib/__tests__/login-route-errors.test.ts`, but the actual file is **`login-route-errors.test.mts`**. tsx prints "Could not find …" to stderr and **does not fail the run** for a missing file argument, so the focused run reported 19/19 pass while covering only the other 4 files. The missing suite was verified separately: `login-route-errors.test.mts` passes **10/10** under the correct ESM runner and is part of the full-suite MTS batch (which passed it). Similarly, the original employee-360 view-model invocation referenced a nonexistent `team-benchmark.test.ts` with stderr suppressed — the 18 passing tests belong to `view-model.test.ts` alone. Severity: LOW (no production impact; full-suite coverage was never affected). **Recommend a separate corrective task**: the focused-run workflow should assert that every intended test file exists (e.g., fail on missing paths) so silent omissions cannot recur. Both report rows corrected in section 10.

### F4 — Phase 1's failure attribution inherited uncritically — *documentation error, corrected*

The 4 evidence-UI failures were listed in Phase 1's report (and copied here) under `smart-quality-report-ui.test.ts`. Grep verification shows those test names exist **only** in `src/lib/quality-observations/__tests__/evidence.test.ts` (tracked-clean); the user-modified `smart-quality-report-ui.test.ts` contains none of them. The failure set itself is unchanged and remains pre-existing: the tests are `readFileSync` source-introspection over `ObservationsPage.tsx` / `EmployeesPage.tsx`, both tracked-clean and untouched by Phase 2. Severity: LOW (report accuracy only). Corrected in section 10 with the evidence.

### F5 — "Orphan drain" wording could be read as cancellation — *wording sharpened, no code defect*

Verified against `src/lib/db.ts` `raceIndexedQuery` (lines ~528-544) and `src/lib/auth.ts` `drainOrphanedQuery` (lines ~286-292): there is **no cancellation** — the Admin SDK exposes none. What the implementation genuinely guarantees (test-pinned): late **rejections** of the losing query are handled (no unhandled rejection can occur), late **results** are ignored (they can never reach a caller or the cache), and the timeout timer is freed when the original settles first. A never-settling query keeps one outstanding request on the RTDB connection for the process/connection lifetime — bounded in accumulation by the per-target breaker. Additionally, the fallback scan is **not** timeout-capped (same as the `findUserByEmail` precedent). Severity: LOW (documented limitation, consistent with the in-repo precedent; the guarantees that ARE claimed are real). Sections 5 and 11 now state this precisely.

### F6 — Single-flight key omits the TTL option (differs from the `getAll` convention) — *investigated; NOT a defect (parity with existing cache semantics)*

`getAll` keys its flights `all:<table>:<ttl>` (TTL in the key); `getAllByChildEqualTo` keys `idxq:<table>:<field>:<value>` (TTL omitted), so two concurrent callers with different `ttl` options for the same target would share one flight and the winner's TTL would select the cache entry. Investigation against the existing code shows this is **exactly the pre-Phase-2 semantics**: `getAll('attendanceResults', TTL.STATIC)` (month reader) and the generation path's `getAll` via `findWhere` (default TTL) already shared ONE table-cache key with divergent TTL intents — the last writer's TTL governed the shared entry. The primitive reproduces that behavior at the `idx:` key level. Current call sites are uniform per target anyway (verified: every (table, field) target is invoked with a single TTL tier across all adoption sites). No stale-beyond-intent window exists that the baseline did not already have. Severity: NONE (documented parity note; no change recommended).

### F7 — Full-suite totals and the 9 baseline failures — *verified genuine*

Totals confirmed from the execution record (`/tmp/phase2-full-suite.log`): TS 3,135/3,128/7, MTS 119/117/2 → 3,254/3,245/9. Count cross-check against Phase 1's record (TS 3,129 / MTS 60): +6 TS (the rules suite) and +59 MTS (17+15+7+20) account for the totals exactly — no existing suite's test count changed. All 9 failures identified by name in the record and individually evidenced as pre-existing (F4 above; items 1–4, 9 in section 10). Severity: NONE.

### Audit conclusion

**All discrepancies are documentation-level (F1–F4) or documented low-severity limitations consistent with the in-repo precedent (F5). No critical or high-severity implementation defect was found** — the query-correctness guarantees (fallback = legacy computation, no partial results, no unhandled rejections, no false success on revocation) are implemented and test-pinned. Phase 2 acceptance is not blocked by any finding in this audit. Two optional follow-ups are recommended as separate tasks: (a) make focused test runs fail loudly on missing file paths (F3), (b) consider a time-capped fallback scan if the uncapped full-node read ever proves problematic in production (F5/section 11.6) — both outside this phase's change restrictions.
