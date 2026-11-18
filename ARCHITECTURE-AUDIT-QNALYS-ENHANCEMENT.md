# QNALYS — Strategic Platform Enhancement
## Architecture Audit & Implementation Plan (Pre-Implementation Deliverable)

**Date:** 2026-11-16
**Status:** AUDIT ONLY — no production code was modified. This document is the required pre-implementation deliverable (items 1–6 of the mission spec) and the gate for approval before Phase 1 begins.
**⚠ SUPERSEDED:** the audit's §5 (implementation plan), §6 (migration), §7 (risks) and §8 (decisions) are superseded by **IMPLEMENTATION-PLAN-REV2-QNALYS-ENHANCEMENT.md** (Phase 0 added, Phase 3 strengthened, user-filter coverage matrix, layered perf methodology). Audit findings (§1–§4) remain authoritative.

**Method:** Full read of the authorization core (`verify-permission.ts`, `config/permissions.ts`, `lib/scope/**`, `lib/organization/**`), plus four exhaustive sweep audits: (1) follow-ups end-to-end flow, (2) authentication architecture, (3) entity/access-policy inventory of all 156 route files (~66 route groups), (4) KPI/quality/AI/evidence/approvals engines + test + i18n infrastructure. All findings cite `file:line`.

---

# 1. ARCHITECTURE AUDIT

## 1.1 Stack summary

| Layer | Technology | Source of truth |
|---|---|---|
| App framework | Next.js 16 App Router, React 19, TypeScript 5 | `package.json` |
| Database | **Firebase Realtime Database** (NOT Postgres) — all tables under `arm_erp/<table>` | `src/lib/db.ts` |
| Data layer | Full-node reads (`getAll` downloads whole table) + **in-memory TTL cache** (5s/15s/30s/60s) + JS post-filtering. RTDB indexed queries (`orderByChild().equalTo()`) are **documented to hang on this network** — circuit-breaker + full-scan fallback exists only for user lookup | `src/lib/db.ts:26-89,165-316` |
| AuthN | Custom JWT — `jose` HS256, 15-min access / 7-day refresh, refresh store in RTDB `arm_erp/sessions`, bcrypt 12 rounds | `src/lib/auth.ts` |
| AuthZ | Single decision function `authorize(caller,{page,section?,action?,field?})` + data-scope engine | `src/lib/verify-permission.ts:269`, `src/lib/scope/**` |
| Org model | Organization Tree (`orgNodes`: general_administration/company/department/team/subteam), `OrgNode.managerUserId` is the only manager relation, `users.linkedEmployeeId` is the only user↔employee bridge | `src/lib/organization/**` |
| Frontend state | TanStack Query v5 (staleTime policies, invalidation domains), Zustand | `src/lib/query-provider.tsx`, `src/lib/cache/**` |
| AI | z-ai-web-dev-sdk (GLM) via gateway with provider registry; exactly ONE production AI feature (Smart Quality Report) with a strict advisory-only doctrine | `src/lib/ai/**` |
| Evidence | Firebase Storage binaries (sharp-optimized WebP), RTDB metadata; 9 registered evidence collections | `src/lib/evidence-storage.ts`, `src/lib/evidence/evidence-collections.ts` |
| Tests | `node:test` + `node:assert/strict` via tsx; **171 test files**, discovered by convention (`src/**/__tests__/*.test.ts`) | `scripts/run-tests.mjs` |
| i18n | Arabic-first inline source + `EN_MAP` translation claims (`<T>` component), stored-label resolver for enums | `src/lib/i18n/**` |

## 1.2 The canonical authorization stack (must be reused — never forked)

Three server-only layers, already composed correctly in ~80 route files:

1. **Authentication** — `authenticateFromRequest` (`verify-permission.ts:186`): JWT verify → fresh user load → **suspension reject** (`:140`) → effective permissions = role preset ← position template ← stored per-user override (`resolveEffectivePermissions`) → carries `linkedEmployeeId`, `positionId`, `orgBoundaryNodeIds`. Request-scoped memoized (WeakMap).
2. **WHAT may I do** — `authorize(caller, {page, section?, action?, field?})` (`verify-permission.ts:269`): admin bypass → page `none` → section `none` → action (edit level + explicit flag, **fail-closed on absent flag**) → field `hidden`. Deny-beats-grant across tiers. `verifyPermission`/`verifyAnyAction`/`authorizeRequest`/`requireAuth` are adapters over it.
3. **WHERE / how much data** — scope engine (`src/lib/scope/`):
   - `resolveOrgBoundary` (`boundary.ts:78`): WHERE — admin → override (`users.orgBoundaryNodeIds`) → assignment (managed nodes ∪ own employee node) → **unresolved = empty (fail-closed)**.
   - `resolveEmployeeScope` (`index.ts:148`): HOW-MUCH — vocabulary `own | team | department | subtree | assigned | all` on the `employees` permission entry; **non-admin without a configured scope fails closed to `own`** (`FAIL_CLOSED_SCOPE`).
   - Row filters (`server.ts`): `resolveEmployeeScopeFromDb`, `employeeInScope`, `filterRowsByEmployeeScope`, `linkedRecordInScope` (fail-closed on unresolvable link), `hasUnrestrictedEmployeeScope`. Doctrine: **AUTHORITY = AUTHORIZED_SCOPE ∩ FILTER** — client params can only narrow, never widen.

## 1.3 Calculation-layer doctrine (TypeScript is authoritative)

- **The ONLY scoring formula:** `computeScoreFromAdjustments` (`src/lib/kpi-scoring/score-calculator.ts:36-51`). All consumers MUST call it.
- **Canonical quality score:** `computeEmployeeScore` (`src/lib/metrics/kpiMetrics.ts:195-259`) — approved, point-bearing observations only; missing data is a status (`PENDING`/`INSUFFICIENT_DATA`/`NOT_MEASURABLE`), never 0.
- **KPI framework:** scheme → components → weights → `aggregateEmployeeKpi`; month close freezes snapshots (`month-lock`); reporting layers (`kpi-reporting/**`) consume engine output verbatim and carry a §28 structured data contract (`KpiReportDataContract`) **designed for an AI consumer** with per-component `evidenceReferences`.
- **Deterministic facts layer:** `performance-intelligence` (aggregates over qualityObservations/qualityDeductions/complaints/capaCases/followUps/travelDeals/attendanceResults; repeated-issue & window-recurrence detection) → consumed by `performance-hub` (read-only analysis; `HubRecommendation {key, rationale: HubEvidenceItem[]}` pattern) and `hr-decision` (status vocabulary deliberately has no termination state; fixed advisory disclaimer).
- **Do-not-touch list (AI must never write here):** `kpi-scoring/score-calculator.ts`, `kpiMetrics.computeEmployeeScore`, `kpi-framework/aggregator.ts` + `quality-adapter.ts` + `employee-result.ts`, month snapshot close pipeline, attendance `compliance`.

## 1.4 AI advisory-only doctrine (established precedent to copy)

The single AI feature (`/api/ai/quality-analysis`) implements the exact pattern Phase 1 must reuse:
- Versioned fixed system prompt; "the deterministic engine owns the numbers" (AI never recomputes); every number in AI output must exist verbatim in input (**hallucination guard drops violating items**); fact/interpretation separation; evidence refs only from the input catalog; **every recommendation born `PROPOSED`**; untrusted-data fencing; provider resolution without auto-fallback; every outcome written to `aiAuditLog`; read-only (`AI_READ_ONLY=true`, `AI_FORBIDDEN_MUTATIONS` list in `src/lib/ai/governance.ts`); UI badge "مقترحة — بانتظار قرار إداري" + AI-generated disclaimer footer.

## 1.5 Reusable workflow primitives for Phase 1

| Need | Existing primitive |
|---|---|
| Draft→Pending→Approved→Rejected history | `src/lib/approvals/` — `ApprovalEvent`, `makeApprovalEvent`, append-only `appendApprovalEvent`, projected status; header explicitly anticipates future approval-gated records |
| Assignment + SLA + stage progression + effectiveness verification + reopen | CAPA (`src/lib/capa-constants.ts`, `capaMetrics.ts`): corrective/preventive blocks, `assignedTo` (user ids), `CAPA_SLA_DAYS`, `verificationResult` (effective/partially/not), `not_effective` → reopen recommendation |
| Recurring-error detection | `src/lib/repetition-detection.ts` (`detectRepetitions` — (employee, source, issueKey) groups in rolling window; sources: followUp/complaint/observation) + `performance-intelligence.detectRepeatedIssues` |
| Supporting evidence references | `{collection, recordIds}` against `EVIDENCE_COLLECTIONS` (9 collections registered with page keys + nav strategy); rendered via `/api/evidence/preview` (per-collection permission + scope, ≤50 ids/call) |
| Employee→assignee resolution | `users.linkedEmployeeId` first, employee-map fallback (CAPA pattern, `capa-cases/route.ts:167-189`) |
| Notifications + automation | `createSmartNotification`, `dispatchAutomationEvent` |

## 1.6 Metadata strategy today

`db.ts createRecord` auto-writes `id` (cuid2), `createdAt`, `updatedAt`; `updateRecord`/`updateRecords` auto-stamp `updatedAt`. **`createdBy`/`updatedBy`/`ownerUserId` are NOT automatic** — caller responsibility. Today: follow-ups/quality/observations/CAPA write actor fields; attendance/requests/travel/hrDeductions/biometrics write none; `employees.createdById` is client-supplied; `master-data` stores actor name not id. Record authorization is uniformly **employee-link based**, never ownership-by-creation (deliberate — creation is not assignment per `scope/server.ts §ASSIGNED`).

---

# 2. ENTITY / ACCESS-POLICY MATRIX

## 2.1 Classification (per the mission's six access models)

| Class | Entities (route groups) | Enforcement today |
|---|---|---|
| **User-owned** | `user-preferences`, `profile`, `unseen` (own read-state), `auth/*` own-record ops | Keyed by `auth.userId`; server derives identity, client ids never widen |
| **Creator-attributed** (actor recorded, NOT owner-filtered) | follow-ups (`createdById/Name`), quality deductions (full actor set), quality observations, CAPA, notifications (`createdBy`), master-data (name only) | Scope-filtered by employee link, not by creator |
| **Employee-related** | attendance, requests, travel, biometrics, employee-documents, hr-deductions, quality, observations, complaints (optional link), CAPA (optional link + `relatedEmployeeIds`), follow-ups, deals | `filterRowsByEmployeeScope` / `employeeInScope` / `linkedRecordInScope` on every list/detail/write incl. reassign targets |
| **Team/department/company** | performance-hub group reports, kpi-dashboard, kpi-reports (scopeLimit), home/stats, risk-center, repetition-alerts, search | Scope-resolved employee sets passed into engines |
| **Shared organizational** (org-global by design) | organization tree, positions, kpi-schemes/settings, month/annual snapshot headers, master-data, observation categories/templates, deduction-rules/rules lists | Page-gated (`organization`, `kpiSettings`, `masterData`, `rulesEngine`, `rules`) |
| **System-wide** | activity-logs (controlPanel), rule-logs, quality-audit-log, ai provider settings (admin-role) | Page-gated or admin-role-gated |

## 2.2 Full per-route inventory

Compressed view (66 groups; `VP` = verifyPermission page gate; `Scope` = canonical scope engine):

| Group | Authz | Record filter | Owner fields | Gap |
|---|---|---|---|---|
| attendance / requests / travel (+upload) | VP + Scope | scoped list; writes `employeeInScope` incl. reassign; uploads unrestricted-only | none | — |
| follow-ups (+[id], escalate-capa) | VP + Scope | scoped; `followedBy` narrowing | createdById/Name ✔ | — |
| complaints (+create-capa) | VP + Scope | scoped `optionalLink:true` | CAPA child ✔ | — |
| capa-cases | VP + Scope | scoped optionalLink + relatedEmployeeIds | ✔ (body values rejected) | — |
| quality (+approve/reject/create-capa/upload) | VP + Scope | scoped | ✔ full actor set | — |
| quality-observations (+approve/reject/migrate) | VP + Scope + `linkedRecordInScope` detail | scoped | ✔ | — |
| hr-deductions (+create-capa) | VP + Scope | scoped | child CAPA only | — |
| biometric (GET/upload/clear) | GET auth-only; writes VP + Scope | scoped | none | GET has no page gate (scope-limited exposure) |
| employees (+upload/org-nodes) | VP + Scope | scoped + field stripping | `createdById` **from body** (attribution only) | inline scope viewer omits `orgBoundaryNodeIds` (gap G3) |
| employee-360/[id] | authorizeRequest employees+employee360+section gate+IDOR-404 | fail-closed | read-only | same G3 |
| employee-performance / analytics / attendance-kpi / attendance-results / hr-performance | VP + Scope | includes/inScope | read-only | — |
| kpi-dashboard / kpi-framework | VP + Scope | authorized employeeIds | read-only | — |
| kpi-reports (9 routes) | VP('kpiReports','view') + secondary authorize on insights | scopeLimit into engine | read-only | — |
| kpi-schemes / kpi-settings / month-snapshots / annual-snapshots | VP (kpiDashboard view / kpiSettings update / monthClose approve) | org-global by design (per-employee payload scoped) | none | — |
| home/stats / risk-center / repetition-alerts / unseen / search | requireAuth (+VP on riskCenter); search has per-domain permission | all scoped | own-state keyed by userId | no page gate on repetition-alerts/unseen (scope-limited) |
| user-preferences / profile | requireAuth | own record only | userId ✔ | — |
| notifications family | VP + single visibility rule (`recipient-visibility.ts`) | directed match / broadcast | ✔ | — |
| evidence upload/preview/image | VP per module + scope from stored record | fail-closed | staged per module | — |
| capa-sla / cron | cron-auth fail-closed OR requireAuth+scope | scoped | read-only | — |
| activity-logs (+online) | POST VP('home','view'); GET/online VP('controlPanel') | GET all to controlPanel | **body-supplied userId** | **G2: spoofable attribution** |
| dashboard/users family | VP('controlPanel') + last-admin guards; `?basic=1` auth-only | full table to controlPanel | server-validated boundary | **G4: basic=1 leaks directory** |
| organization / positions | VP('organization') | org-global by design | validated managerUserId | — |
| master-data | VP('masterData') | org-global | actor **name** only | — |
| **rules/[id], rules/execute/[id], rules/seed-capa-templates** | **requireAuth ONLY** | none | none | **G1: unauth'd-page CRUD/execute** |
| **rules list/POST, rules/stats, rule-logs, deduction-rules list/POST** | VP('rulesEngine'/'rules') | org-global | ✔ caller | deduction-rules seed **auth-only (G1)** |
| **deduction-rules/[id] PUT/DELETE** | **requireAuth ONLY** | none | none | **G1** |
| knowledge-base | GET auth-only; writes VP('knowledgeBase') | all articles | none | **G5: GET unpaginated auth-only** |
| observation-categories / templates | VP + requireAuth favorites | org-global | ✔ | — |
| ai/* | admin-role gate + rate limits | global settings | ✔ | — |
| auth/login, refresh, logout, me, change-password | public allowlist / bearer; suspension checks | own record | password own | — |
| health | public | single-record probe | — | — |

## 2.3 Security gap list (pre-existing; relevant to Phase 3)

- **G1 — Missing page gates (mutations):** `rules/[id]` GET/PATCH/DELETE, `rules/execute/[id]`, `rules/seed-capa-templates` GET/POST, `deduction-rules/[id]` PUT/DELETE, `deduction-rules/seed` are auth-only. Any authenticated user can modify/delete automation & deduction rules, execute a rule (CAPA-creating, notification-firing) aimed at any employee (`rules/execute/[id]` body.employeeId has **no scope validation**). Contrast: their sibling list/POST routes ARE gated — this is an oversight class, caught by the static `route-auth-regression.test.ts` which only verifies an auth primitive marker, not a page gate.
- **G2 — Activity-log spoofing:** `activity-logs` POST writes client-supplied `userId/userName/userEmail` verbatim with only `home:view` required. Forged rows poison online-status and the Control Panel audit trail.
- **G3 — Boundary-override divergence:** `employees` GET and `employee-360/[id]` build scope viewers inline **without `orgBoundaryNodeIds`**, so a per-user boundary override is silently ignored on exactly the two most employee-data-centric paths (they resolve wider than the override intends). Everywhere else uses `authScopeViewer`/`asScopeViewer` which carry it.
- **G4 — User directory exposure:** `dashboard/users?basic=1` returns the complete user directory (id/name/role) to any authenticated user.
- **G5 — Auth-only unpaginated reads:** `knowledge-base` GET returns all articles to any authenticated user (no `knowledgeBase:view` gate); `biometric` GET / `repetition-alerts` / `unseen` are auth-only but fully scope-filtered (limited exposure).
- **G6 — Owner-field hygiene:** several tables write no actor fields; `employees.createdById` client-supplied; master-data stores name not id. No `ownerUserId` anywhere (ownership-by-creation is deliberately NOT the authorization model — employee-link scope is).

## 2.4 Authorization test coverage (existing proof)

`route-auth-regression` (static auth-primitive guard on every route), `m02/m021 route-permission-regression` (gate + exact page key pins, no invented keys), `m03-organization-data-scope` (fail-closed, tier inheritance, boundary matrix), `m04-scoped-write-paths` (38 route files pinned incl. reassign targets, uploads unrestricted-only), `m05-scoped-read-lists` (scoped filtering before search/sort/pagination; fail-closed rows; detail-route `linkedRecordInScope`), scope-engine matrix suites, `permissions/__tests__` (authorize core, sections, fields, scope-source display==enforcement). **What is NOT yet proven:** per-record cross-user isolation for user-owned entities (preferences/unseen/profile), export/print/aggregation parity (partially covered by m05), and the G1/G2/G3/G4 gaps (tests would currently fail — that is the point of fixing them in Phase 3).

---

# 3. FOLLOW-UPS BOTTLENECK ANALYSIS (Phase 2 baseline)

## 3.1 Data flow today

`GET /api/follow-ups` (`src/app/api/follow-ups/route.ts:30-177`): `getAll('followUps')` = **full-node read** (comment at :60-64 documents WHY: RTDB indexed range queries hang on this network — the design decision is codified) → scope filter → month/period restriction (unparameterized requests default to current month via `resolveFollowUpsMonth` — bounded) → in-JS field filters → `sortByDateField` → `withEmployee` (cached map) → response.

**Pagination: ABSENT.** The route never reads `page`/`pageSize`. Response ships: the entire filtered month's full record bodies + a **cross-month, unbounded attention set** (`attentionOverdue` + `attentionDueToday` computed over ALL history in scope, :99-110) + per-employee risk aggregates.

## 3.2 Client behavior

`FollowUpsPage.tsx` (1902 lines): `useFollowUpsList(month, range)` — server sends only the period; **all other filtering is client-side** (`filtered` useMemo :512-537: date re-check, dept, priority, overdueOnly, dueTodayOnly, free-text search, status, type) with `employees.find(...)` executed **per record inside the filter** (:524, :846, :869, :1174 — O(n×m)). **No pagination, no virtualization** (framer-motion `<motion.tr>` per row). Details/evidence eager (list already carries full bodies). `AoccLayout.tsx:135` fetches `pageSize: 100` — **a param the server ignores** (pseudo-pagination; same dead-param bug in capa hook).

## 3.3 Quantified bottleneck list

1. Every list GET downloads the whole `followUps` node (5s TTL cache amortizes across pollers within one process only) then filters/sorts in JS.
2. Unbounded attention arrays recomputed and shipped on EVERY response (cross-month overdue over full history).
3. Full record bodies (descriptions, notes, evidenceItems) shipped for list rendering; no summary/detail split.
4. Client-side filtering incl. O(n×m) employee-name lookups per row; re-sort client-side.
5. N+1-class repeats: POST create does a **second full `followUps` scan** for the 30-day risk check (:386) + full `employees` scan for one record's labels; `escalate-capa` scans all `capaCases` for sequence numbering; risk-center is O(n²) (`recentSameType` inside per-record loop); employee-360 double-reads the table per request (dataset loader + route).
6. Seven+ consumers each re-fetch the same underlying data through different param shapes (page, AOCC, home/stats, risk-center 30s poll, unseen poller, search, report runners) — cache sharing only within the TTL window per process.
7. **No RTDB indexes for followUps; no `.indexOn` anywhere** (`firebase.json` has no database rules). Native RTDB queries exist in exactly 4 places (user lookup, sessions, notification listener, ping) — the indexed path is actively distrusted on this network.
8. Filters supported server-side but unused by the page: `followedBy` (creator), `responsiblePerson`, `status` param. No creator/employee filter UI on the page at all.

## 3.4 Reusable pagination precedents

`capa-cases` (`limit/offset` + `{data,total,limit,offset}` envelope), `attendance-results`/`attendance-kpi` (`limit/offset` + deterministic ordering), `activity-logs` (`limit` slice), `quality-audit-log` envelope + client `parseAuditLogPayload` normalizer. Client page/pageSize hook convention already exists (currently decorative).

---

# 4. AUTHENTICATION COMPATIBILITY ASSESSMENT (Phase 4)

## 4.1 Current auth surface

| Route | Behavior | Controls |
|---|---|---|
| `POST /api/auth/login` | credential login: email format, **rate limit** (5/15min, 30min lockout), suspension 403, bcrypt verify (+legacy plaintext rehash), mint access+refresh, persist refresh | `resetRateLimit` on success; structured `errorKey` taxonomy |
| `POST /api/auth/refresh` | verify refresh JWT + RTDB session, user not suspended, **single-use rotation** | no rate limit |
| `POST /api/auth/logout` | revoke one or all refresh tokens | bearer |
| `GET /api/auth/me` | user shape + permissions | suspension 403 |
| `POST /api/auth/change-password` | verify current, bcrypt rehash, revoke all refresh tokens | no rate limit |

Client (`AuthContext.tsx`): tokens in **localStorage** (`erp_access_token/erp_refresh_token/erp_user`); proactive refresh at 12min; shared refresh mutex in `api-fetch.ts` with 401→refresh→retry; visibility-aware `/me` polling. Login is state-driven (no redirect). `api/biometric/**` is **attendance fingerprint-import** — unrelated to authentication (naming collision only).

## 4.2 User record shape (arm_erp/users)

`id, email (lowercased), name, password (bcrypt12), role ('admin'|'hr'|'manager'|'quality'|'user'), rank, permissions (stored override map), isSuspended, suspendedAt, photoURL, jobTitle, mobile, responsibilities, positionId, linkedEmployeeId, orgBoundaryNodeIds, createdAt, updatedAt`. **No `status`/`pending`/`emailVerified`/approval vocabulary exists** — the only account-state gate is the binary `isSuspended`, checked at login, refresh, `/me`, and the single choke point `verify-permission.ts:140`.

## 4.3 Compatibility verdicts

- **Passkeys — low friction.** The session mint is a well-isolated block (`login/route.ts:189-208`): sign pair → `storeRefreshToken` → return `{accessToken, refreshToken, user:{...}}`. Extract it into a shared `createSessionForUser(user, {method})` helper consumed by login, refresh (already duplicates it), and the new passkey verify route. Needs: new RTDB store `arm_erp/webauthnCredentials`, `PUBLIC_PATHS` additions, suspension-check parity, `@simplewebauthn/*` deps, env `WEBAUTHN_RP_ID` + origin allowlist, counter replay protection, credential CRUD + revocation. Middleware security headers do not block `publickey-credentials`. The biometric auth method (fingerprint vs face) is chosen by the device OS — WebAuthn handles this natively; the site never picks the modality.
- **Registration + email verification + admin approval — moderate friction, three greenfield axes:**
  1. **No email infrastructure at all** (no provider, no token store, no templates) — requires a decision (see §7 Open Decisions).
  2. **User model lacks every needed field** — needs `status` ('pending'|'active') + `emailVerified`; a shared `canAuthenticate(user)` predicate must replace the four scattered `isSuspended` checks (login :149, refresh :30, /me :27, verify-permission :140).
  3. **New public endpoints** need their own rate limits (existing limiter is in-memory, email-keyed).
  The admin-approval half fits the existing Control Panel pattern (`verifyPermission('controlPanel','edit')` + `writeConfigAudit` before/after, exactly like suspension today).
- **Audit gap:** `logLogin`/`logLogout` in `activity-logger.ts:54-60` have **zero call sites** — login events are never recorded today (client-side logger only). Phase 4 must add server-side auth-event auditing for login, passkey, registration, approval, rejection, credential management.

---

# 5. IMPLEMENTATION PLAN (per phase)

Global rules honored: one phase at a time; no duplicate permission/KPI/ownership engines; all sensitive checks server-side; additive-only RTDB paths (no destructive migrations); backward compatibility; existing workflows preserved.

## Phase 1 — Employee Development Intelligence

**Principle:** recommendations are generated by a deterministic TypeScript engine from already-authorized data; AI is optional, advisory-only, and reuses the Smart-Quality-AI doctrine verbatim. No automatic deductions/scores/disciplinary decisions — recommendations carry `PROPOSED`/draft semantics until a human approves.

**New module** `src/lib/development-intelligence/` (pure builders + injectable loaders — testable without Firebase, matching codebase convention):
- `generator.ts` — `buildDevelopmentRecommendations(dataset, options)`: consumes `getEmployeePerformanceDataset` (facts) + `performance-hub/analysis.ts` (dimension status/changes) + `hr-decision` statuses + `repetition-detection` groups; emits structured recommendations across the required categories (development / corrective / preventive / training / measurable objectives) with thresholds exported as named constants (doctrine: thresholds in one constants block, no opaque scoring).
- Each recommendation carries the full required schema: `employeeId`, `category`, `evidenceReferences [{collection, recordIds}]`, `reason/explanation`, `priority` (from CAPA SLA vocabulary: critical/high/medium/low), `suggestedAction`, `suggestedOwnerUserId` (resolved via `users.linkedEmployeeId` of the managing node), `suggestedDeadline` (from CAPA `effectiveSlaDays` precedent), `expectedMeasurableOutcome`, `status`, `approvalInfo`, `reviewHistory[]`, `outcomeHistory[]`.
- `types.ts` + `index.ts` barrel. **Status machine:** `draft → pending_approval → approved → assigned → in_progress → completed → effectiveness_review` (+ `rejected`, `cancelled` terminal). Append-only history via `lib/approvals` primitives (`makeApprovalEvent`/`appendApprovalEvent`); status projected on the record; effectiveness review mirrors CAPA `verificationResult` semantics (`effective|partially_effective|not_effective` → `not_effective` spawns a follow-up recommendation, never an automatic deduction).
- `ai-advisor.ts` (optional layer, behind provider availability): dataset→input builder→fencing→hallucination guard→`PROPOSED`-only output→`aiAuditLog`; never writes recommendations automatically — AI output lands as *suggestions attached to the draft for the human editor to accept or discard*.

**Storage:** new RTDB table `arm_erp/developmentRecommendations` (additive; no migration — RTDB is schemaless). Evidence attachments reuse the evidence system by registering the collection in `evidence-collections.ts` (page key below).

**Permission key:** new APP_PAGES entry `developmentPlan` (id `developmentPlan`, page `التطوير والتدريب`) with `availableActions: ['create','update','delete','approve','reject','assign','close']`. **Safe defaults:** `'none'` in every non-admin role preset (HR preset gets `read` as the natural consumer; delegation otherwise via the Permission Manager — exact precedent: `organization` page). API gates: `verifyPermission(request,'developmentPlan', action)`; generation + all reads/writes narrowed by `resolveEmployeeScopeFromDb`/`employeeInScope` (generation only ever sees in-scope employees; out-of-scope requests fail closed with 404 anti-enumeration).

**API routes** (all new, all gated):
- `GET/POST /api/development-recommendations` (list w/ limit/offset + filters employee/category/status/priority; POST = human-created draft or generate-for-employee)
- `GET/PUT/DELETE /api/development-recommendations/[id]`
- `POST .../[id]/approve | reject | assign | start | complete | effectiveness` (each a small state-transition route with permission + scope + history append + notification + automation dispatch, mirroring CAPA route structure)
- Reuses: evidence upload/preview/image (registered collection), notifications, activity audit.

**UI:** new page component registered in the router + sidebar (group: employee_mgmt); sections: recommendation list (scoped, filterable), detail drawer with evidence links (via `/api/evidence/preview`), approval/assignment controls gated by `PermissionGate`; recommendations also surfaced read-only in Employee Performance Hub as a new section gated by the `developmentPlan` page key (server-side section gate — existing hub doctrine). i18n: Arabic inline + `EN_MAP` entries + `presentation.ts` status labels + coverage test.

**Tests:** pure-generator tests (injectable loaders; category/priority/evidence/deadline invariants); state-machine tests (legal/illegal transitions, history append-only); authorization tests (scope fail-closed generation, out-of-scope 404, approve permission required, admin bypass only); route-permission regression will auto-pin the new routes.

**AI boundary guarantee:** `AI_FORBIDDEN_MUTATIONS` extended with `developmentRecommendations`; the generator itself is deterministic and versioned (`ENGINE_VERSION` on every recommendation for audit).

## Phase 2 — Daily Follow-ups Performance Optimization

**Constraint honored:** RTDB indexed queries hang on this network (documented, with a proven circuit-breaker pattern). Plan therefore optimizes **payload, filtering, and consumers**, not speculative indexed queries.

1. **Server-side pagination + full server-side filtering on `GET /api/follow-ups`:** accept `page/pageSize/limit/offset` (cap pageSize, e.g. ≤200), `q` (search), `department`, `status`, `type`, `priority`, `overdueOnly`, `dueTodayOnly`, `followedBy`, `responsiblePerson`, `employeeId` — all applied server-side before slicing; response envelope `{data, total, limit, offset}` (capa-cases precedent). Keep the month/period window (existing bounded contract + its tests).
2. **Independent summary endpoint** `GET /api/follow-ups/summary`: counts by status/type/priority/overdue/dueToday + per-employee risk — **recomputed from the cached full read, decoupled from the list response**; the unbounded cross-month attention set moves here, capped and paginated (overdue list with limit/offset).
3. **List/detail split:** list rows return display projection (id, dates, employee, subject, status, type, priority, evidence count); full body + evidence fetched lazily via the existing `/api/evidence/preview` projection path or a `?include=full` detail GET — lazy loading of details/attachments.
4. **Client changes** (`FollowUpsPage.tsx` + `use-queries.ts`): real pagination controls + configurable page size persisted in `user-preferences`; debounced search (300ms) wired to the server param; request cancellation via AbortController in `api-fetch` for in-flight list requests; replace per-row `employees.find` with one memoized `Map` (O(n) build, O(1) lookup — fixes all four sites); proper loading/empty/error/pagination states; lightweight virtualization for the table view (no new dependency — windowed rendering over the paged slice; pages are already bounded by pageSize).
5. **N+1 / consumer fixes:** POST-create 30-day risk check reuses the cached `getAll` (no second network read within TTL — already the case, made explicit + counted in diagnostics); risk-center `recentSameType` loop → precomputed index Map; AOCC hook stops sending dead `pageSize` (uses real limit param); useFollowUpsList passes server filters instead of client filtering.
6. **Indexes:** add `.indexOn` rules file + document an **optional** indexed-path experiment behind a server flag using the existing `raceWithTimeout` + circuit-breaker utilities from `db.ts` — deployed only if the perf harness proves the network tolerates it. Default remains the month-bounded full read.
7. **Performance measurement:** `scripts/perf-followups.mjs` — synthetic dataset generator (configurable N: 5k/20k/100k records), before/after timing of GET list, POST create, risk-center, and page render metrics; results recorded in the phase delivery report (before-numbers captured at phase start against the unmodified code).
8. **Preserved:** all workflows, permissions, evidence, history, escalation, notifications; contract tests `period-filtering.test.ts` must keep passing.

**Tests:** route tests for pagination envelope + server filter correctness + scope-before-paginate ordering; hook tests for debouncing/cancellation; pure-function tests for the summary aggregation and risk-center index fix.

## Phase 3 — Global User Filtering and Secure Data Isolation

**3a. Pre-existing gap remediation (from §2.3 — same domain, fixed within this phase):** G1 missing page gates on `rules/[id]`, `rules/execute/[id]`, `rules/seed-capa-templates`, `deduction-rules/[id]`, `deduction-rules/seed` (+ scope validation on `rules/execute/[id]` employeeId); G2 activity-logs actor derived from the authenticated caller (body identity fields rejected); G3 boundary-override divergence fixed by routing `employees` GET + `employee-360/[id]` through `authScopeViewer`; G4 `basic=1` restricted to minimal fields actually needed by the consuming selector (or permission-gated); G5 knowledge-base GET gated; static regression tests extended to pin page gates (catches the G1 class permanently).

**3b. Metadata strategy:** extend `db.ts` with optional actor parameter — `createRecord(table, data, actor?)` writes `createdById/createdByName`, `updateRecord(..., actor?)` writes `updatedById/updatedByName` (backward compatible: existing call sites unchanged, actor added route-by-route in this phase). **No `ownerUserId` introduced** except where ownership is meaningful (already exists implicitly: user-preferences/unseen keyed by userId). Creator is attribution metadata, never an authorization basis (existing doctrine preserved).

**3c. Global user filter (reusable, per-page persistent):**
- Server: a small shared helper `parseUserFilter(searchParams, caller, scopeCtx)` supporting `createdBy` (single), `createdByIn` (multi), `assignedTo`, `relatedUserId`, validated as **narrowing-only** — a requested user outside the caller's visible set yields empty results, never widened scope (fail-closed; scope∩filter doctrine already codified).
- Applied to list endpoints of creator-attributed entities (follow-ups, quality, observations, CAPA, complaints, notifications) and to report engines via the existing `scopeLimit` pattern; consistent in tables, dashboards, reports, print, and export (print/export consume the same server-filtered data — no separate client filtering path).
- Client: a shared `UserFilterBar` component (single / multi-select / creator / assigned / employee-related modes) persisted per page through the existing `user-preferences` API; comparison-between-users mode added to the group-report + KPI report control bars.
- Persistence keys per page; no behavior change when the filter is unset (backward compatible).

**3d. Isolation hardening + tests:** automated matrix tests proving an unauthorized user cannot **read, search, aggregate, export, update, or delete** another user's private records: user-preferences (cross-user GET/PUT 404/403), unseen state, profile, follow-ups `followedBy` narrowing (cannot widen), activity-logs cross-user reads (controlPanel-only), search across domains, evidence preview/image for out-of-scope records, report engines with hostile scopeLimit params, record-ID enumeration on `[id]` routes (404-anti-enumeration already the pattern — pinned by tests). Fail-closed assertions where ownership/authorization cannot be resolved (`linkedRecordInScope` semantics generalized).

**Authorization behavior documentation:** per-entity access model table (§2) becomes the reference in `docs/`; each changed route keeps its canonical `verifyPermission`/`authorize` + scope call (no parallel mechanism — the mission's `authorize({user,page,action,section,field,record})` maps to the existing `authorize(caller,input)` + record-scope composition, unchanged).

## Phase 4 — Passkey Authentication and Account Registration

**4a. Session mint refactor (preparatory, safe):** extract `createSessionForUser(user, {method})` into `src/lib/auth/session.ts` (sign pair → store refresh → reset rate limit → response payload). Login + refresh refactored onto it; behavior byte-identical; existing tests unchanged.

**4b. Passkeys (WebAuthn, `@simplewebauthn/server` + `@simplewebauthn/browser`):**
- Store: `arm_erp/webauthnCredentials/{credentialId}` = `{userId, publicKey, counter, transports, deviceLabel, createdAt, lastUsedAt, revoked}` — multiple credentials per account; metadata + device management; revocation flag (+ hard delete option).
- Routes: `POST /api/auth/passkey/register-options` (auth'd), `POST .../register` (verify attestation; origin + RP ID validation), `POST /api/auth/passkey/authenticate-options` (public; challenge), `POST .../authenticate` (public; verify assertion → counter **replay protection** (reject counter ≤ stored) → `canAuthenticate(user)` → `createSessionForUser`); `GET /api/auth/passkeys` (own devices), `DELETE /api/auth/passkeys/[id]` (own revoke; controlPanel admins may revoke any).
- Env: `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGINS` (allowlist), fail-closed startup validation like `JWT_SECRET`.
- Middleware: add the two public passkey routes to `PUBLIC_PATHS`; keep register routes bearer-gated. Fallback authentication (password) remains fully functional — passkeys are additive.
- Device picks the biometric modality (Touch/Face/Windows Hello) natively — the server stores only `transports`/`authenticatorAttachment` metadata.
- Recovery: password login remains the recovery path; a "passkey removed → password fallback" note on the device-management UI; optional `requiresPasswordChange` flow unchanged.

**4c. Registration (Sign-Up with approval):**
- New fields on users: `status: 'pending'|'active'` (+ reuse `isSuspended` for suspension), `emailVerified: boolean`. Shared predicate `canAuthenticate(user)` = `status==='active' && emailVerified && !isSuspended` — replaces the four scattered suspension checks (single choke-point edit; admin-seeded users migrated to `active` lazily on first write or via one-time backfill script — additive field, `undefined` treated as active for legacy records **only until the phase ships**, then the predicate treats undefined as active-with-warning; explicit decision documented in the phase report).
- `POST /api/auth/register` (public, rate-limited, duplicate-email 409 via `findUserByEmail`): creates `status:'pending', role:'user', permissions: {}` — **no default administrative permissions** (DEFAULT preset already minimal; stored override empty). Email verification token stored at `arm_erp/verifications/{hash}` mirroring the sessions pattern (hashed, TTL, single-use).
- Email sending: provider abstraction `src/lib/email/` with env-configured transport (`EMAIL_PROVIDER=none|smtp` — `none` = dev/log mode where verification URLs are logged and an admin can verify manually from the Control Panel; production recommendation: SMTP/Resend — see Open Decision D2).
- `GET /api/auth/verify-email?token=` (public) → sets `emailVerified`.
- Approval queue: Control Panel section listing pending users; `POST /api/dashboard/users/[id]/approve|reject` gated `verifyPermission('controlPanel','edit')` + `writeConfigAudit` (before/after) — approving sets `status:'active'`. Rejected accounts stay `pending`+`rejected` and can never authenticate (fail-closed predicate).
- Login/refresh/me/verify-permission all enforce `canAuthenticate` (pending users get a distinct `errorKey: 'ACCOUNT_PENDING_VERIFICATION'|'ACCOUNT_PENDING_APPROVAL'`).
- Sign-Up page: dedicated public page component reachable from the login screen; state-driven like the existing login (no redirect pattern); zero changes to the existing permission model.
- **Audit:** server-side auth-event log (`arm_erp/authAuditLog` via `writeAudit`): registration, email verification, approval, rejection, login (password + passkey, incl. failures), logout, credential registration/removal/revocation — fixes the existing `logLogin` dead-code gap.

**Backward compatibility:** existing users unaffected (`status` undefined → active); invitation path = admin creating users via the existing Control Panel route (already audited) — unchanged.

---

# 6. MIGRATION & ROLLBACK STRATEGY

| Concern | Strategy |
|---|---|
| Database | RTDB is schemaless — every phase is **additive paths only** (new tables: `developmentRecommendations`, `webauthnCredentials`, `verifications`, `authAuditLog`; new optional fields: user `status/emailVerified`, actor fields, filter metadata). **No existing path is rewritten or removed.** No broad migration required at any point. |
| Backfill | One tiny optional backfill per phase, idempotent scripts under `scripts/` (e.g., user `status` backfill, actor-field enrichment) — runnable, re-runnable, never destructive. |
| Rollback | Per phase: `git revert` of the phase merge is a complete rollback because no existing records are mutated in incompatible ways. New tables/fields left behind are inert. Feature flags where behavior switches are risky (follow-ups server pagination flag default-on with instant revert; indexed-path experiment default-off). |
| Deploy safety | Pre-deploy Firebase RTDB export (documented command) before each phase goes to production; verify `pingDatabase` + health after deploy. |
| Permission keys | Additive `APP_PAGES` entries with explicit `'none'` non-admin presets (safe-defaults doctrine) — no stored permission map needs rewriting; missing-key inheritance already resolves through role presets. |
| Tests as guardrails | `route-auth-regression` + `m02` pins are extended in the same commit as any gate change, so a rollback of code also rolls back pins consistently. |

---

# 7. RISK ASSESSMENT & DEPENDENCIES

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | RTDB indexed queries hang on this network (documented); Phase 2 pagination must not depend on them | High | Month-window bounded reads + payload/summary split + measured before/after; indexed path only behind default-off flag with the proven circuit breaker |
| R2 | In-memory caches are per-process — cache sharing assumptions break on multi-instance deploys | Medium | Measurements run against single-process reality (current deploy); noted as a documented limitation |
| R3 | localStorage token storage (XSS exposure) is pre-existing | Medium | Out of scope to redesign; passkey work does not worsen it; server-side session revocation already exists |
| R4 | `canAuthenticate` choke-point edit touches 4 auth paths — a bug could lock out users | High | Shared predicate + exhaustive unit tests + backward-compatible `undefined → active` migration window + rollback plan |
| R5 | Email infrastructure absence blocks full self-serve verification | Medium | Provider-abstracted design; `none` mode with admin manual verification keeps the flow functional without a provider |
| R6 | New permission key/Page must not break `route-auth-regression`/`m02` static tests | Low | Same-commit APP_PAGES + gate wiring (established pattern — every prior page did this) |
| R7 | Follow-ups page is 1902 lines — refactor risk to existing workflows | Medium | Server contract stays URL-compatible; period-filtering contract tests keep passing; UI changes additive (pagination bar, states) with existing behaviors default-preserved |
| R8 | G1-G5 fixes change behavior of previously "open" endpoints (any authed user → gated) | Medium | Called out explicitly in the phase report; consumers enumerated before change (Rules UI runs as admin/manager per presets — no functional consumer of the ungated paths exists among non-privileged presets: `rules`/`rulesEngine` are `'none'` for hr/user presets) |
| R9 | AI advisory layer drift (AI computing scores) | High | Governance: AI output `PROPOSED`-only, hallucination guard, `AI_FORBIDDEN_MUTATIONS` extension, deterministic generator owns every number, engine versioning + tests |
| R10 | 171-test baseline — unknown pre-existing failures | Low | Baseline `npm test` run recorded at Phase 1 start; baseline failures reported separately from phase regressions (per mission spec) |

**New dependencies:** Phase 4 only — `@simplewebauthn/server`, `@simplewebauthn/browser` (small, no transitive risk), optional email transport lib. Phases 1–3: **zero new dependencies**.

**Execution order:** Phase 1 → 2 → 3 → 4 (mission order). Phase 3's gap fixes (3a) are sequenced inside Phase 3 because they are authorization-surface changes needing their own test pins; they do not block Phases 1–2 (Phases 1–2 build on the already-correct canonical gates).

---

# 8. OPEN DECISION POINTS (need user input before/at phase start)

- **D1 (Phase 1):** Where should recommendations surface primarily — a dedicated sidebar page under "Employee Management" (proposed) plus a read-only section inside the Employee Performance Hub? Or hub-only?
- **D2 (Phase 4):** Email transport for verification — (a) SMTP via env (e.g., existing mail server), (b) a hosted API provider, or (c) `none` mode with manual admin verification only.
- **D3 (Phase 3):** Confirm the remediation of pre-existing gaps G1–G5 is in scope for Phase 3 (recommended), or defer to a separate security hardening task.
- **D4 (Phase 2):** Confirm acceptable default page size (proposed 25, cap 200) and whether the cross-month attention panel should remain on the page (served by the new capped summary endpoint) or move to a dedicated view.

---

# 9. VERIFICATION BASELINE (to be recorded at Phase 1 start)

- `npm test` (171 files), `npx tsc --noEmit`, `npm run lint`, `npm run build` — results recorded in the Phase 1 delivery report; baseline failures reported separately per the mission spec.
