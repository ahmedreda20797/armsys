# QNALYS — Strategic Platform Enhancement
## Implementation Plan REV2 (supersedes §5–§7 of the Architecture Audit plan)

**Date:** 2026-11-16
**Basis:** Architecture audit (ARCHITECTURE-AUDIT-QNALYS-ENHANCEMENT.md — findings unchanged and still authoritative) + reviewer directives:
1. New **Phase 0 — Security Hardening** before all feature development (G1–G5).
2. **Strengthened Phase 3** — real user data isolation with an explicit per-entity access-policy matrix (creator visibility is policy, not merely attribution).
3. **System-wide global user filter** with a page-by-page coverage matrix.
4. **Layered follow-ups performance measurement** (DB read / server / transfer / rendering — reported separately, no conflated claims).
5. All existing architecture constraints preserved (canonical authorization engine, scope engine, KPI engines, AI advisory doctrine, approval/CAPA workflows, TypeScript calculation layer, additive-only DB changes, rollback capability).

**No production code is modified by this document.**

---

# 1. REVISED PHASE SEQUENCE

```
Phase 0 — Security Hardening (G1–G5)          ← NEW, gates everything
Phase 1 — Employee Development Intelligence   (as audited, builds on Phase 0)
Phase 2 — Daily Follow-ups Performance        (as audited + layered benchmarks §5)
Phase 3 — User Data Isolation & Global Filter (strengthened per §2/§3 below)
Phase 4 — Passkeys & Account Registration     (as audited)
```

Gate rule between phases (unchanged + hardened): each phase ends with focused tests, authorization tests, TypeScript validation, ESLint on touched files, production build, and a documented delivery report. **Phase 0 additionally requires every new authorization regression test to pass before Phase 1 may start.**

Phase contents at a glance:

| Phase | Core scope | Moved/changed vs REV1 |
|---|---|---|
| 0 | G1 page gates + rule-execution scope, G2 activity-log actor, G3 boundary-override consistency, G4 minimal user directory, G5 KB read gate; regression pins for each; static route-gate test extension | Moved out of REV1's Phase 3 into its own phase |
| 1 | Development Intelligence (unchanged from audit §5) | Preconditioned on Phase 0 |
| 2 | Follow-ups performance (unchanged in design; measurement methodology replaced by layered harness §5) | Benchmark methodology replaced |
| 3 | Per-entity access-policy enforcement (creator/assigned/manager semantics per matrix §3), explicit auditable sharing, system-wide user filter (§4), isolation test matrix. **No longer contains G1–G5** (done in Phase 0) | Strengthened |
| 4 | Passkeys + registration (unchanged from audit §5 Phase 4) | — |

---

# 2. PHASE 0 — SECURITY HARDENING (detailed)

All changes ride the **existing** canonical engine (`verifyPermission`/`authorize` + scope engine). No new mechanisms.

## G1 — Missing page-level gates + rule-execution scope

Routes currently auth-only (any authenticated user), pinned by audit `file:line`:

| Route | Change | Gate chosen (rationale) |
|---|---|---|
| `GET src/app/api/rules/[id]/route.ts:14` | add `verifyPermission(request,'rulesEngine','view')` | read gate mirrors the list route |
| `PATCH src/app/api/rules/[id]/route.ts:47` | add `verifyPermission(request,'rulesEngine','edit')` | page-level edit — preserves current de-facto access of roles holding rulesEngine edit (admin, quality preset) without inventing new action flags; hr/user presets (`none`) now correctly denied |
| `DELETE src/app/api/rules/[id]/route.ts:143` | add `verifyPermission(request,'rulesEngine','edit')` | same |
| `POST src/app/api/rules/execute/[id]/route.ts:15` | add `verifyPermission(request,'rulesEngine','edit')` **+** `employeeInScope` validation of `body.employeeId` (out-of-scope → fail-closed 404) | execution mutates operational state (creates CAPA, fires notifications); targeting an employee must respect the caller's organizational scope — currently unscoped |
| `GET/POST src/app/api/rules/seed-capa-templates/route.ts:331/282` | add `verifyPermission(request,'rulesEngine','edit')` | bulk configuration seeding |
| `PUT src/app/api/deduction-rules/[id]/route.ts:13` | add `verifyPermission(request,'rules','edit')` | mirrors deduction-rules list/create gate |
| `DELETE src/app/api/deduction-rules/[id]/route.ts:51` | add `verifyPermission(request,'rules','edit')` | same |
| `POST src/app/api/deduction-rules/seed/route.ts:18` | add `verifyPermission(request,'rules','edit')` | canonical rules reseed |

Deliberate behavior changes (documented in the Phase 0 delivery report): hr/user-role callers lose access to these endpoints (their presets are `none` — they were never UI-reachable for them). Admin bypass unchanged. `execute-all` (admin-role) unchanged.

**Regression tests (new, per-gap):**
- `m06-security-rules-gates.test.ts` — for each changed route × {unauthenticated, dummy token, suspended user, `rulesEngine/rules: none` role, valid editor role, admin}: assert 401/403/allow per matrix; assert `rules/execute/[id]` with an out-of-scope `employeeId` fails closed (404) and in-scope passes; assert actor on rule writes remains server-derived.
- `route-auth-regression.test.ts` **extension** — in addition to the auth-primitive marker, every route file must now reference a PAGE gate primitive (`verifyPermission|authorizeRequest|verifyAnyAction`) or appear on a reviewed, commented exception allowlist (auth routes, health, cron, self-scoped routes). This permanently catches the G1 class.

## G2 — Activity-log actor identity server-derived

`src/app/api/activity-logs/route.ts:23-36`: `userId/userName/userEmail` are taken **exclusively** from the authenticated caller (`authenticateFromRequest`); client-supplied identity fields are rejected/ignored. `online/route.ts` unchanged (reads become trustworthy automatically).
**Test:** forged `userId` in POST body is never persisted; the stored row attributes the caller; cross-user GET still controlPanel-only.

## G3 — Organization boundary overrides respected consistently

`src/app/api/employees/route.ts:57` and `src/app/api/employee-360/[id]/route.ts:96` switch their inline scope viewers to `authScopeViewer`/`asScopeViewer` (which carry `orgBoundaryNodeIds`) — the same adapters the other ~80 route files already use. No engine change.
**Test:** a user whose explicit boundary override is narrower than their assignment sees the override scope on BOTH endpoints (previously saw the wider assignment tier); scope matrix suite extended with this case.

## G4 — Minimal user directory

`GET /api/dashboard/users?basic=1`: first enumerate its consumers (`useDashboardUsers('basic')` call sites — responsible-person/creator selectors); reduce the response to the minimum consumed fields (expected: `id, name`; add `photoURL` only if a consumer renders avatars; drop `role` unless a consumer needs it). Response shape versioned in the hook's type; consumers updated in the same commit.
**Test:** `?basic=1` response contains ONLY the whitelisted keys; `mobile/password/permissions/orgBoundaryNodeIds/email` never present; unauthorized caller still 401.

## G5 — Knowledge Base read gate

`GET src/app/api/knowledge-base/route.ts:7` → `verifyPermission(request,'knowledgeBase','view')`. Deliberate behavior change: generic-role users (preset `none`) lose anonymous-API article access — matching the KB page's own gate.
**Test:** none-role 403; reader-role 200; admin bypass; article bodies never leak pre-gate.

## Phase 0 acceptance criteria (gate to Phase 1)

1. Every remediation above landed with `file:line` trace in the delivery report.
2. All new regression tests pass; the full authorization suite (route-auth-regression, m01–m05 pins, scope matrix) passes **including the extended static page-gate guard**.
3. `npx tsc --noEmit`, ESLint on touched files, `npm run build` green.
4. Behavior-change list explicit (endpoint × role × before/after) with zero unlisted changes.
5. No file outside the enumerated routes/tests touched.

---

# 3. STRENGTHENED PHASE 3 — ACCESS-POLICY MATRIX (per-entity visibility semantics)

## 3.1 Policy vocabulary

Classes (one per entity, explicit in code as `ENTITY_ACCESS_POLICY[entity]`):
- **PRIVATE** — user-owned. Visible to the owner + System Owner (admin bypass) only.
- **DRAFT_PRIVATE** — private to the creator until formally submitted; after submission the entity's normal class applies.
- **EMPLOYEE** — employee-related; visibility = employee-link ∩ caller's organizational scope (canonical scope engine).
- **EMPLOYEE_OPT** — employee-related when linked; **organizational** (visible to page-permission holders) when no employee link exists.
- **SHARED** — shared organizational record; visible to holders of the page permission.
- **DIRECTED** — visible to explicit recipients only (existing notification rule: directed match / staff broadcast).
- **AUDIT** — system audit trail; visible to controlPanel/audit permission holders only.

Creator identity is **not** an authorization basis for EMPLOYEE/SHARED classes (business requirement: quality and management oversight must see in-scope records regardless of author); it IS the authorization basis for PRIVATE/DRAFT_PRIVATE classes. `assignedTo`/`responsiblePerson`/`relatedEmployeeIds` grant access through the existing `assigned` scope vocabulary and per-record assignee checks — already canonical, now pinned per-entity.

## 3.2 The matrix (required columns per directive)

Legend — Create/View: permission key + action; Creator: creator's default visibility; Assigned: assignee/responsible/recipient access; Mgr: manager access path.

| Entity | Class | Create | View | Creator default | Assigned access | Manager access | Additional grant / sharing rule |
|---|---|---|---|---|---|---|---|
| user-preferences | PRIVATE | self (auth) | self | ✔ sole | — | — | none. Server keys record by `auth.userId`; cross-user = 404 |
| unseen read-state | PRIVATE | self | self | ✔ sole | — | — | none |
| profile | PRIVATE | system | self | ✔ sole | — | — | none (controlPanel sees users list, not profile payload) |
| passkey credentials (Ph4) | PRIVATE | self | self | ✔ sole | — | — | controlPanel admin may revoke (audited) |
| sessions/refresh tokens (Ph4 device list) | PRIVATE | system | self | ✔ sole | — | — | controlPanel admin session view stays AUDIT-scoped |
| development recommendations (Ph1) `status=draft` | **DRAFT_PRIVATE** | `developmentPlan:create` + target in scope | creator only | ✔ sole until submit | — | — | submit (`pending_approval`) flips class to EMPLOYEE_OPT |
| development recommendations `≥pending_approval` | EMPLOYEE_OPT | workflow actions gated (`approve/assign/close` flags) | `developmentPlan:view` + scope | ✔ retains edit until assigned; read always | assignee (`assignedTo`) read/write via assign action | subtree/department/team scope via employee link | explicit `sharedWith[]` (auditable grant, §3.4) |
| follow-ups | EMPLOYEE | `followUps:create` + target in scope | `followUps:view` + scope | read via scope (creator has no extra privilege — oversight requirement); creator narrows own view via `followedBy` filter | responsiblePerson: scope-visible; surfaces in `assigned` scope resolution | subtree/department/team scope via employeeId | `followedBy` = server-side narrowing filter only, never a widening |
| quality deductions | EMPLOYEE | `quality:create` + in scope | `quality:view` + scope | read via scope | — | scope | approver (`quality:approve`) sees pending in scope |
| quality observations | EMPLOYEE | `observations:create` + in scope | `observations:view` + scope | read via scope | — | scope | approver (`observations:approve`) |
| CAPA cases | EMPLOYEE_OPT | `capa:create` + employeeId + all relatedEmployeeIds in scope | `capa:view` + scope (`optionalLink`, `relatedEmployeeIdsField`) | read via scope | `assignedTo`/`correctiveAssignedTo` (user ids) — in scope resolution + notifications | scope | — |
| complaints | EMPLOYEE_OPT | `complaints:create` + optional link in scope | `complaints:view` + scope (optionalLink) | read via scope | — | scope | unlinked = organizational |
| hr deductions | EMPLOYEE | `hrDeductions:create` + in scope | `hrDeductions:view` + scope | read via scope | — | scope | approver flag |
| attendance / biometrics | EMPLOYEE | `attendance:*` / `biometric:upload` (upload unrestricted-scope) | `view` + scope | read via scope | — | scope | — |
| attendance results / KPI results / month snapshots (per-employee payload) | EMPLOYEE | engine/system | `view` + scope | n/a | — | scope | header metadata SHARED to page viewers |
| requests | EMPLOYEE | `requests:create` + in scope (requester = linked employee's record) | `requests:view` + scope | read via scope | approver (`requests:approve`) | scope | — |
| travel deals | EMPLOYEE | `travel:create` + in scope | `travel:view` + scope | read via scope | — | scope | bulk upload unrestricted-scope |
| employee documents | EMPLOYEE | `employees:update` + in scope | `employees:view` + scope | read via scope | — | scope | sensitive-field stripping applies |
| notifications | DIRECTED | `notifications:create` | visibility rule (`recipient-visibility.ts`): admin → content permission → directed match → staff broadcast | creator may see own broadcast | recipients (`assignedTo`, `recipientUserIds`, directed linkedEmployeeId) | staff-role broadcast | already enforced; pinned by tests |
| evidence items | inherits parent record's class | module create permission | parent record's view path (`linkedRecordInScope`) | — | — | — | preview/image resolve scope from the STORED record link |
| organization tree / positions | SHARED | `organization:create/update/delete` | `organization:view` | n/a | — | — | shared model by design |
| master data / observation categories / templates | SHARED | `masterData:*` / `observationCategories:*` / `observationTemplates:*` | respective view | attribution name recorded | — | — | template favorites are PRIVATE per-user state |
| KPI schemes / KPI settings / deduction rules / automation rules (config) | SHARED | `kpiSettings:update` / `rules:create,edit` / `rulesEngine:edit` | respective view | attribution recorded (server-derived post-G2) | — | — | Phase 0 gates applied |
| knowledge base | SHARED | `knowledgeBase:create` | `knowledgeBase:view` (Phase 0 G5) | read via permission | — | — | — |
| snapshots (headers) / reports outputs | SHARED | system/generated | page view + scopeLimit in engines | n/a | — | scope into engines | — |
| activity logs / quality audit log / rule logs / AI audit / auth audit (Ph4) | AUDIT | system/server-derived actor only (G2) | `controlPanel:view` / `qualityAuditLog:view` / `rulesEngine:view` | n/a | — | — | userId on GET = narrowing filter, admin-gated |
| booking items / deals | EMPLOYEE | `travel:create` + scope | `travel:view` + scope | read via scope | — | scope | — |

**Enforcement obligation (tested, not asserted):** for every row, the server enforces the policy on **list, detail, search, update, delete, export, print, aggregation** endpoints:
- list/detail/update/delete — existing route gates + scope (Phase 0 pins them);
- search — `search-service.ts` per-domain permission + scope (pinned);
- export — report runners + `/api/reports/run` take the server-resolved `scopeLimit`; export permission flag gates the action; exports honor the same entity filters as lists;
- print — print views render data fetched from the same gated endpoints (no separate data path exists; verified and pinned);
- aggregation — home/stats, risk-center, kpi-reports, dashboards already scope-limit; Phase 3 adds matrix-driven tests per endpoint type.

## 3.3 Creator-visibility semantics — explicit decisions

| Decision | Rationale |
|---|---|
| Operational records (follow-ups, quality, CAPA, complaints, deductions, requests, travel, attendance) stay **scope-visible, not creator-private** | Quality/management oversight is the business function; creator-private would silently break approval workflows, AOCC/home/employee-360 aggregation, and the existing permission model (mission: preserve existing workflows). Creator attribution remains visible and filterable. |
| New Phase 1 recommendations get **DRAFT_PRIVATE** drafts | The only genuinely private work product: a draft is the creator's unfinished proposal. Submission is the explicit act of sharing it into the approval workflow. |
| PRIVATE class stays exactly where ownership is meaningful (preferences, state, credentials, profile) | Already keyed by `auth.userId`; Phase 3 adds the missing cross-user isolation tests. |
| Explicit sharing (`sharedWith[]`) is introduced **only** where a sharing act is meaningful: Phase 1 recommendations (share draft/record with specific users) | Keeps the mechanism narrow, auditable, and out of unrelated modules. |
| `users.linkedEmployeeId` remains the ONLY user↔employee bridge; no `ownerUserId` on operational records | Prevents a parallel ownership model (mission rule). |

## 3.4 Explicit sharing (auditable)

- Field: `sharedWith: Array<{userId, grantedBy, grantedAt}>` on supported entities (Phase 1 recommendations first).
- Server: read check = `scope match OR creator OR sharedWith contains caller OR admin`; enforced on list/detail/update/delete/export/aggregation identically.
- Audit: every grant/revoke appends to the record's history + `writeAudit` (auditable by design).
- Client ids can only narrow the caller's own authorized scope; a `sharedWith` grant can never exceed the granter's own scope (validated server-side at grant time).

## 3.5 Phase 3 isolation test matrix (acceptance evidence)

Generated from the matrix — per entity × per endpoint-type × per role{owner, creator, in-scope manager, out-of-scope manager, generic user, admin}: unauthorized read/search/aggregate/export/update/delete must fail closed; authorized paths must pass. Includes record-ID enumeration (404 anti-enumeration) and hostile-filter cases (`?userId=`/`?createdBy=` never widen). Snapshot of test files added: `m07-entity-access-matrix.test.ts` (data-driven over `ENTITY_ACCESS_POLICY`), plus per-entity additions to m05-style suites.

---

# 4. GLOBAL USER FILTER — SYSTEM-WIDE COVERAGE MATRIX

## 4.1 Filter modes

`creator` (records authored by user X) · `assigned` (records where X is assignee/responsible/recipient) · `employee` (records/performance of X's linked employee) · `org` (organizational scoping — scope engine, always on, not a "filter") · `multi` (multi-user selection incl. comparison) · `n/a` (not logically applicable).

Consistency requirements: the filter is **server-side** (`parseUserFilter` helper — narrowing-only, fail-closed); persisted per page via `user-preferences`; the same filter params flow into **tables, dashboards, reports, exports, and print** (print renders the server-filtered dataset; export endpoints accept the identical filter params). Client-side filtering is UX convenience layered on an already-server-filtered set — never the boundary.

## 4.2 Coverage matrix (every relevant page)

| Page / surface | creator | assigned | employee | multi/comparison | Server endpoints that must accept the filter | Notes |
|---|---|---|---|---|---|---|
| Home (widgets: follow-ups, activity) | ✔ | ✔ | ✔ | — | `/api/home/stats?userId=` (widget narrowing) | scope always applied first |
| Operations Center | ✔ | ✔ | ✔ | — | AOCC query endpoints | decision list narrows by actor/employee |
| Daily Follow-ups | ✔ (`followedBy` exists) | ✔ (`responsiblePerson` exists) | ✔ (`employeeId` exists) | — | `/api/follow-ups` (params exist; UI wiring + persistence added in Ph2/Ph3) | filter bar gains user selector |
| Notifications | — | ✔ (recipient=self) | directed | — | `/api/notifications` | self by default; admin may filter by recipient |
| Employees | — | — | ✔ (linked-user) | — | `/api/employees` | employee master data; org scope governs |
| Employee 360 / Performance Hub (single) | — | — | ✔ (is the subject) | — | `/api/employee-360/[id]`, `/api/performance-hub` | subject-scoped by design |
| Group Performance Reports | — | — | ✔ | ✔ (multi-user comparison) | `/api/performance-hub/group` | per-member filtering + user-vs-user comparison |
| Attendance | ✔ (recorded-by, post-Ph3 actor fields) | — | ✔ | — | `/api/attendance` | actor fields added in Phase 3 metadata |
| Biometric | ✔ (imported-by) | — | ✔ | — | `/api/biometric` | uploader attribution |
| Requests | ✔ (requester's linked user) | ✔ (approver) | ✔ | — | `/api/requests` | |
| Quality (deductions) | ✔ (`createdById`) | — | ✔ | — | `/api/quality` | param added if absent |
| Quality Observations | ✔ (observer) | — | ✔ | — | `/api/quality-observations` | |
| CAPA | ✔ (`createdBy`) | ✔ (`assignedTo`) | ✔ (+related) | — | `/api/capa-cases` | |
| Complaints | ✔ (`responsiblePerson`) | — | ✔ (optional) | — | `/api/complaints` | |
| HR Deductions | ✔ | ✔ (approver) | ✔ | — | `/api/hr-deductions` | |
| Risk Center | — | — | ✔ | — | `/api/risk-center` | org aggregation; employee narrowing |
| KPI Dashboard | — | — | ✔ | — | `/api/kpi-dashboard` | scopeLimit exists |
| KPI Reports (all modes incl. flexible) | — | — | ✔ | ✔ (user-vs-user comparison rows) | `/api/kpi-reports/*` | scopeLimit exists; comparison mode added |
| Smart Quality Report | ✔ (observer filter) | — | ✔ | — | `/api/reports/run` + insights | same engine scopeLimit |
| Reports (incl. quality deductions report) | — | — | ✔ | ✔ | `/api/reports/run` | export/print take identical params |
| Quality Audit Log | ✔ (actor) | ✔ | — | — | `/api/quality-audit-log` | actor = user filter |
| HR Decision/Performance | — | — | ✔ | ✔ | `/api/hr-performance/*` | |
| Travel | ✔ | — | ✔ | — | `/api/travel` | existing travel-filters extended |
| Knowledge Base | ✔ (author, marginal) | — | — | — | `/api/knowledge-base` | optional; default n/a |
| Rules / Rules Engine / Rule logs | ✔ (`createdById`) | — | — | — | `/api/rules`, `/api/rule-logs` | post-Phase-0 gates |
| Activity Logs | ✔ (`userId`, admin view) | — | — | — | `/api/activity-logs` | narrowing on admin-gated GET |
| Employees master/upload | — | — | — | — | — | n/a (org data) |
| Organization / Positions / Workflow Designer | — | — | — | — | — | n/a (organizational) |
| Master Data / Categories / Templates / Schemes / Settings / Month Close / KPI Settings | — | — | — | — | — | n/a (configuration; no user-related records displayed) |
| Control Panel | ✔ (user directory IS the filter target) | — | — | — | `/api/dashboard/users` | administrative search by user |
| Profile / Preferences | — | — | — | — | `/api/user-preferences` | PRIVATE; filter stores per-page persistence here |

**Coverage acceptance:** every page marked ✔ ships the server-side param + the shared `UserFilterBar` UI (single/multi/creator/assigned/employee modes as applicable) + per-page persistence; every page marked n/a documents why. A data-driven test (`user-filter-coverage.test.ts`) asserts the endpoint↔filter mapping table stays in sync with the shipped params.

---

# 5. FOLLOW-UPS PERFORMANCE MEASUREMENT METHODOLOGY (layered)

**Honest model (per directive):** the month-bounded full-node read remains the Firebase access pattern; therefore **L1 (Firebase read) is NOT claimed to improve** unless an optional, separately-measured indexed path proves stable. Pagination/filtering/lazy-detail improvements are claimed at L2/L3/L4 only. Consumer deduplication does reduce L1 *frequency* (fewer duplicate full-node reads per interval across the 7+ consumers).

## 5.1 Layers and instruments

| Layer | What is measured | Instrument | Reported as |
|---|---|---|---|
| **L1 Firebase read** | wall-clock of the RTDB `.get()` for `arm_erp/followUps` (month window = current design; optional indexed variant flag-gated); payload size downloaded; reads/minute across all consumers (dedup effect) | `performance.now()` instrumentation around the db call (dev diagnostics already exist at route L68 — extended to log separately); consumer counter via cache-hit/miss stats (`getCacheStats`) | ms + KB per read; reads/min before/after |
| **L2 Server processing** | scope resolution, JS filtering, sort, risk/attention aggregation, serialization — per stage | stage-wise `performance.now()` marks between read-completion and response-constructed; logged in the existing `§PERF-FOLLOWUPS` diagnostic | ms per stage + total, p50/p95 over N requests |
| **L3 API response size & transfer** | JSON bytes (before: full bodies + unbounded attention; after: projection + summary split), `transferSize`/duration from Resource Timing on the client | response byte count server-side; `performance.getEntriesByName` / Resource Timing API in the browser harness | KB + ms before/after |
| **L4 Browser rendering & interaction** | React commit duration for the list (initial + filter change), interaction latency (filter/typing → UI update, with 300ms debounce noted separately), scroll/interaction smoothness on the paged table | React Profiler API (`onRender` durations) + `performance.mark/measure` injected in a scripted browser session (browser automation harness against the dev server) | ms per commit + p95 interaction latency |

## 5.2 Harness

- `scripts/perf-followups.mjs` (tsx): seeds a synthetic dataset into an isolated table path (`arm_erp_perf/followUps`, configurable N = 5,000 / 20,000 / 100,000; realistic shape — employee spread, statuses, types, dates over 12 months, evidence counts); runs **server-layer benchmarks by direct invocation** (L1/L2) with warm and cold cache; emits JSON + a markdown table.
- HTTP benchmark (L3): `autocannon`-style scripted fetch runs against `next dev` (or `next start`) for the GET list endpoint, before-code and after-code on the SAME dataset.
- Browser benchmark (L4): scripted browser session (existing browser automation tooling) loading the Follow-ups page, capturing React Profiler marks + Resource Timing; identical scenario script before/after.
- Protocol: same machine, same dataset, 3 runs each, report median + p95; baseline captured **before** any Phase 2 code change; every improvement claim cites the layer it came from.
- Cleanup: perf table path removed after measurement; no production data touched.

## 5.3 Expected, honestly-attributed outcomes

| Change | Layer that improves | Layer explicitly NOT improved |
|---|---|---|
| List/detail projection + summary split | L3 (bytes), L2 (serialization), L4 (render) | L1 (full month still read — stated plainly) |
| Server-side filters + pagination | L3, L2 (less per-request JS), L4 (fewer rows) | L1 |
| Attention move to capped summary endpoint | L3, L4 | L1 |
| Consumer dedup (AOCC/home/risk reuse + shared cache) | L1 frequency (reads/min) | — |
| Debounce + request cancellation | L4 interaction, L1/L2 request volume | — |
| Optional indexed-path experiment (flag-gated, measured) | L1 — **only if** the network proves stable; otherwise documented as not-viable with measurements | — |

---

# 6. DEPENDENCIES & MIGRATION / ROLLBACK (updated)

| Phase | New dependencies | DB changes (additive only) | Rollback |
|---|---|---|---|
| 0 | none | none (gates + field whitelists only) | git revert; behavior-change list reverts with it |
| 1 | none | new table `arm_erp/developmentRecommendations` (+ optional `sharedWith` on it) | git revert; orphan table inert |
| 2 | none | none (existing paths; optional `.indexOn` rules file behind measured flag) | git revert; flag off |
| 3 | none | optional actor fields (`createdById/updatedById/Name`) added on writes going forward; `sharedWith[]` on supported entities; **no backfill required** (legacy records keep working — absence of actor fields is valid) | git revert |
| 4 | `@simplewebauthn/server`, `@simplewebauthn/browser`; optional email transport | new tables `webauthnCredentials`, `verifications`, `authAuditLog`; user fields `status`/`emailVerified` (additive; `undefined` = active for existing users, documented migration window) | git revert; new tables inert; legacy login untouched |

Per-phase deploy safety unchanged: RTDB export before deploy, health probe after, feature flags for risky switches (server pagination default-on with instant revert; indexed-path default-off).

---

# 7. PHASE ACCEPTANCE CRITERIA (summary; each phase's delivery report verifies all)

**Common (every phase):** focused tests pass; authorization tests pass; `npx tsc --noEmit` clean; ESLint on touched files clean; `npm run build` succeeds; delivery report lists changed/added files, DB & API changes, authorization behavior, test results, and any baseline failures separately; existing modules verified functional (route-auth-regression + m-series suites green).

- **Phase 0:** §2.1 checklist complete with file:line trace; per-gap regression tests + extended static page-gate guard pass; behavior-change table explicit; no unrelated files touched. **Gate: Phase 0 authorization tests green before Phase 1 starts.**
- **Phase 1:** deterministic generator tests (thresholds/evidence/deadline invariants); 7-state workflow transition tests (legal/illegal, append-only history); scope fail-closed generation tests (out-of-scope 404); approve/assign/close permission tests; AI advisory layer gated (`PROPOSED`-only, hallucination guard, audit log); `developmentPlan` key registered with safe defaults (none for all non-admin presets except documented HR `read`); route pins green.
- **Phase 2:** layered benchmark table (L1–L4, before/after, same datasets 5k/20k/100k) with honest attribution — **no claim that pagination reduces the month-bounded Firebase read**; all listed filters enforced server-side; `{data,total,limit,offset}` envelope; independent capped summary endpoint; UI loading/empty/error/pagination states; debounced search + cancellation; period contract tests still green; follow-up workflows/permissions/evidence/history preserved (verified by existing suites + manual checklist).
- **Phase 3:** `ENTITY_ACCESS_POLICY` implemented as data; matrix-driven isolation tests (entity × endpoint-type × role) pass — unauthorized cross-user read/search/aggregate/export/update/delete fail closed; explicit sharing auditable; `user-filter-coverage.test.ts` mapping in sync; UserFilterBar shipped on every ✔ page with persistence; print/export consume server-filtered data (pinned).
- **Phase 4:** passkey register/authenticate/revoke tests incl. replay-counter, origin, RP-ID validation; `canAuthenticate` predicate unit tests + choke-point wiring tests (login/refresh/me/verify-permission); registration flow tests (duplicate 409, pending gates, verification TTL/single-use, admin approve/reject audited); audit log assertions for every auth event; legacy password login byte-identical (existing login tests unchanged and green).

---

# 8. OPEN DECISIONS (updated)

- **D1 (Phase 1)** — recommendations surfacing: dedicated page + read-only Hub section (proposed) / hub-only / page-only. *(carried over)*
- **D2 (Phase 4)** — email transport: SMTP via env / hosted API / `none` mode with admin manual verification. *(carried over; provider-abstracted either way)*
- **D4 (Phase 2)** — default page size 25 (cap 200) and capped attention panel placement. *(carried over)*
- ~~D3~~ — resolved by this revision: G1–G5 now own Phase 0.
- **D5 (Phase 3, new)** — confirm the creator-visibility decisions in §3.3: operational records remain scope-visible (not creator-private), DRAFT_PRIVATE applies to Phase 1 recommendation drafts only, explicit sharing ships on recommendations first. This is the matrix the server will enforce — please confirm or adjust before Phase 3.

---

# 9. EXECUTION CHECKLIST (once approved)

1. Record baseline: `npm test` (171 files), `npx tsc --noEmit`, ESLint, `npm run build` — results into the Phase 0 report.
2. Phase 0 implementation → tests → full verification → delivery report → **approval gate**.
3. Phase 1 → … → Phase 4, one phase at a time, delivery report each.
