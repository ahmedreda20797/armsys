# ARM ERP — Milestone 10 Technical Report

**Enterprise Organization, Access Control & Personal Workspace Foundation**
Status: COMPLETE — HARD STOP at the Milestone 10 boundary.

---

## 1. Scope delivered

| Area | Delivered |
|---|---|
| Organization model | Configurable parent/child node hierarchy (`arm_erp/orgNodes`), generic depth to 10, pure graph engine, admin CRUD + validated moves + impact preview |
| Position architecture | Position catalog (`arm_erp/positions`) with reusable permission templates overlaid inside the SINGLE resolver (role < position < stored) |
| User ↔ Employee linking | Optional `users.linkedEmployeeId`, admin-assigned only, uniqueness-enforced. **No employee accounts created — ever** |
| Page permissions | Preserved unchanged (`none/read/edit` + 7 action keys); new `organization` page registered with a safe admin-only default |
| Section permissions | `PagePermission.sections` + `resolveSectionAccess` + `SectionGate` — **FOUNDATION ONLY — NOT WIRED into any page yet** |
| Field permissions | Preserved from Milestone 9 untouched |
| Data Scope engine | `PagePermission.scope` (`all/department/team/subtree/assigned/own`) + organization-aware resolver in `src/lib/scope`; wired into `GET /api/employees`; **inert by default** (no existing grant carries a scope) |
| Personal workspace | Per-user sidebar ordering + dashboard widget order/visibility (`arm_erp/userPreferences/{userId}`), permission-first reconciliation, reset (recovery) |
| Notification routing | Write-side central router (`recipientUserIds`) + read-side directed matching extended with routed recipients and the employee linkage (closes the M9 gap) |
| Explainable authorization | `explainPageAccess` (simulator / inspector / conflict detector in one pure function) + `diffPermissionMaps` (change preview) |
| Audit | All security-relevant config changes audited via the EXISTING `writeAudit` primitive into `arm_erp/configAuditLog` |
| Tests | 85 new tests across 6 suites (plan items A–G) |

## 2. Architecture inspected (before any change)

- **Permission core** `src/config/permissions.ts`: single resolver `resolveEffectivePermissions`, `PermissionLevel = none|read|edit`, `ActionKey` (7 actions), `APP_PAGES` (29 pages), `SIDEBAR_GROUPS`, M9 field layer (`FieldAccess`, `SENSITIVE_FIELDS = { employees: { mobile } }`), Part K documented as unimplemented.
- **Backend authz** `src/lib/verify-permission.ts` (`verifyPermission` / `requireAuth` / `authenticateFromRequest` — used by 82 route files), JWT via `src/lib/auth.ts`, edge middleware (Bearer presence).
- **User model** `arm_erp/users`: role/permissions(JSON)/rank/isSuspended. **Employee model** `arm_erp/employees`: free-text `department`/`position`, no team/manager/salary fields (verified by grep — none exist).
- **No organization/department/team/position structures existed** — greenfield, so nothing was duplicated; the free-text strings were left as display data.
- **Notifications**: M9 single read-side rule (`recipient-visibility.ts`), dedup predicates, polling policy.
- **Sidebar/page registry/dashboard**: `APP_PAGES` is the source of truth; Sidebar renders `visiblePages` grouped by `SIDEBAR_GROUPS`; HomePage hand-composes cards behind `canViewPage` gates; no widget registry existed (created).
- **Audit**: generic `writeAudit` primitive + `qualityAuditLog`/`hrAuditLog` precedent — reused, not replaced.
- **Milestone reports** M6–M9 read; all completed behavior preserved (M9's uncommitted work was already in the working tree and untouched except where explicitly extended).

## 3. Existing mechanisms reused (no duplicates)

- `resolveEffectivePermissions` remains the ONLY resolver — the position template is a new optional **parameter** of the same function; every legacy caller is unchanged and byte-compatible (tested).
- `verifyPermission`/`requireAuth` unchanged in signature and semantics; `authenticateFromRequest` gained optional fields (`linkedEmployeeId`, `positionId`) and an opt-in position lookup that never fires for legacy users.
- Page registration follows the established pattern (APP_PAGES + PageId union + PageRouter case + ICON_MAP + explicit preset entries).
- Audit reuses `writeAudit` with a caller-chosen collection (`configAuditLog`), exactly like Quality/HR.
- The scope vocabulary lives ON `PagePermission` (as the M9 Part-K note anticipated), not in a parallel structure.
- Notification delivery reuses the Notification Center record, dedup predicates, and the M9 read-side rule — the router only adds a recipient list the rule already knows how to match.

## 4. New files

**Core (pure, unit-tested):**
- `src/lib/organization/types.ts` — OrgNode/Tree types, table names, AR labels
- `src/lib/organization/graph.ts` — buildOrgIndex, subtreeIds, ancestorIds, isDescendantOf, findAncestorOfType, validateMoveNode (cycle/depth/status), resolveManagerChain, groupEmployeesByNode, employeeIdsInSubtree, previewOrgImpact, buildOrgTree, buildEmployeeMovePatch, MAX_ORG_DEPTH
- `src/lib/organization/positions.ts` — Position type, parsePositionTemplate, findInvalidTemplateKeys, normalizePositionTemplate
- `src/lib/organization/index.ts` — barrel
- `src/lib/scope/index.ts` — DataScope resolution (resolveEmployeeScope, filterEmployeesByScope, describeDataScope)
- `src/lib/personalization/index.ts` — reconcileSidebarOrder, resolveWidgetLayout, sanitizeUserPreferencesInput, USER_PREFERENCES_TABLE
- `src/lib/notifications/routing.ts` — resolveNotificationRecipients (5 dimensions + permission gate), fireRoutedNotification (never-throw delivery)
- `src/lib/audit/config-audit.ts` — CONFIG_AUDIT_LOG_TABLE + writeConfigAudit
- `src/config/dashboard-widgets.ts` — DASHBOARD_WIDGETS registry (5 widgets)

**APIs:**
- `src/app/api/organization/route.ts` — GET tree+membership+users; POST create node (one-company rule, depth guard)
- `src/app/api/organization/[id]/route.ts` — PUT rename/retype/manager/order/archive; DELETE empty-node only
- `src/app/api/organization/move/route.ts` — validated move + audit + manager notification
- `src/app/api/organization/impact/route.ts` — read-only impact preview + move validation
- `src/app/api/organization/employees/move/route.ts` — relationship-only employee move + audit + manager notifications
- `src/app/api/positions/route.ts`, `[id]/route.ts` — CRUD with template validation + holder-block on delete
- `src/app/api/user-preferences/route.ts` — GET/PUT(merge)/DELETE per-user, JWT-keyed identity

**Client:**
- `src/components/pages/organization/OrganizationPage.tsx` — 3-tab configuration center (الهيكل / الوظائف / وصول المستخدمين)
- `src/components/shared/SidebarCustomizeDialog.tsx` — per-user sidebar reorder/reset (arrow-based, mobile-safe)
- `src/components/shared/DashboardCustomizeDialog.tsx` — per-user widget visibility/order/reset
- `src/hooks/use-user-preferences.ts`, `src/hooks/use-sidebar-order.ts`

**Tests:** `src/lib/organization/__tests__/org-graph.test.ts` (15), `positions.test.ts` (10), `src/lib/scope/__tests__/data-scope.test.ts` (13), `src/lib/personalization/__tests__/personalization.test.ts` (15), `src/lib/notifications/__tests__/routing.test.ts` (14), `src/lib/permissions/__tests__/section-permissions.test.ts` (18).

## 5. Modified files

- `src/config/permissions.ts` — DataScope + scope/sections on PagePermission, migratePermission scope validation, position-template parameter, `organization` page + explicit `none` in the 4 non-admin presets, resolvePageScope, PAGE_SECTIONS + resolveSectionAccess, explainPageAccess, diffPermissionMaps
- `src/types/index.ts` — `Employee.orgNodeId?`, `AppNotification.recipientUserIds?`, `PageId + 'organization'`
- `src/lib/verify-permission.ts` — `AuthenticatedCaller` (+optional linkage/position), position overlay in authenticateFromRequest, linkedEmployeeId threaded through VerifyResult
- `src/contexts/AuthContext.tsx` — buildAuthUser passes the position template (client/server parity)
- `src/app/api/auth/me/route.ts`, `login/route.ts` — expose positionId/positionPermissions/linkedEmployeeId
- `src/app/api/employees/route.ts` — data-scope enforcement after the (preserved) field stripping; `'all'` fast path identical to legacy behavior
- `src/app/api/notifications/route.ts`, `[id]/route.ts`, `notification-stats/route.ts` — viewer now carries linkedEmployeeId (rule itself extended in recipient-visibility.ts)
- `src/lib/notifications/recipient-visibility.ts` — directed match extended: recipientUserIds + employeeId↔linkedEmployeeId; isDirectedNotification includes routed lists; docs updated (M9 gap marked RESOLVED)
- `src/app/api/dashboard/users/route.ts` — list returns positionId/positionTitle/positionPermissions/linkedEmployeeId
- `src/app/api/dashboard/users/[id]/route.ts` — validated positionId/linkedEmployeeId updates (+uniqueness 409) + config audit
- `src/app/api/dashboard/users/[id]/permissions/route.ts` — payload validation + before/after audit with exact diff
- `src/hooks/usePermissions.ts` — getScope, getSectionAccess, canViewSection
- `src/components/shared/PermissionGate.tsx` — SectionGate
- `src/components/layout/Sidebar.tsx` — ordered pages via useSidebarPages (both variants), تخصيص القائمة entry, Network icon
- `src/components/pages/HomePage.tsx` — overview cards render from resolveWidgetLayout (content untouched), تخصيص button
- `src/components/pages/ControlPanelPage.tsx` — UserRecord fields, editor initializes with the position template, scope selector per page (scope/sections preserved through edits)
- `src/app/page.tsx` — organization route + lazy import

## 6. Organization model

Generic parent/child nodes (`company|department|team|subtree` vocabulary, arbitrary nesting to depth 10): `id, name, type, parentId, managerUserId (+name snapshot), status(active|archived), order, description, timestamps`. Employees attach via `Employee.orgNodeId` (optional). Moving a node/employee changes ONLY the relationship — scope resolution follows automatically (tested: moving an employee between teams changes a team-scoped viewer's accessible set with zero permission edits). `employee.department`/`position` free-text strings are NEVER rewritten (no silent data transformation).

## 7. Permission architecture

`PAGE → SECTION → ACTION → FIELD → DATA SCOPE`, all on one map through one resolver:
- **Page**: unchanged vocabulary; `organization` page added with safe default (admin-only; explicit `none` in HR/manager/quality/default presets; legacy stored maps inherit the same via preset fallback — tested).
- **Section**: `PagePermission.sections` overrides; page gate always wins; inherit by default. Registry seeds Employee-360 section ids. **FOUNDATION ONLY — NOT WIRED.**
- **Action**: unchanged (`canDoAction` + `verifyPermission(request, page, action)`).
- **Field**: M9 mechanism untouched.
- **Position templates**: middle tier — role preset < position template < stored override; absent template = byte-identical legacy resolution (tested). Client (`AuthContext`), server (`authenticateFromRequest`) and the Control Panel editor all resolve through the same rule with the same inputs (parity fields added to /api/auth/me + login).

## 8. Data Scope architecture

`DataScope = all|department|team|subtree|assigned|own` carried on `PagePermission.scope` (invalid values dropped by migratePermission — fail-safe). `src/lib/scope` resolves a viewer+page into an employee-id set against the org graph: department/team = nearest typed ancestor subtree; subtree = managed nodes ∪ own; assigned = caller-supplied assignments ∪ own; own = linked employee. Admin always `all`. Viewers without linkage resolve EMPTY people-scopes (fail-closed — tested). **Enforcement point: `GET /api/employees`** — scope `'all'` (today's universal default) takes the unchanged fast path; a configured narrower scope loads the org tree and filters rows server-side. No other route's row-filtering was changed (documented extension points).

## 9. User vs Employee distinction

Preserved and made explicit: Employees remain DATA records; Users remain operators. The ONLY bridge is optional `users.linkedEmployeeId`, created exclusively by an administrator through the Organization page (validated against the employees table, one-to-one enforced). No login credentials, accounts, or sessions are ever created for employees. The org node's `managerUserId` references a User; `Employee.orgNodeId` references a node — no User field was added to Employee.

## 10. Personal workspace architecture

`arm_erp/userPreferences/{userId}` (one record per user, JWT-keyed server-side — body userId is never trusted and is stripped by sanitization, tested). Sidebar order + dashboard widget order/hidden lists. Reconciliation is **permission → available set → personalization**: revoked pages/widgets can never resurrect from a saved order; new pages append gracefully (all tested). Reset = DELETE (Personal Workspace Recovery), surfaced in both dialogs. The sidebar still renders from the SAME `APP_PAGES` registry (`useSidebarPages` = `visiblePages` reordered) — no duplicate registry.

## 11. Notification routing architecture

Write side (`routing.ts`): Event → route → recipient resolution (direct users / roles / node managers / employee reporting chain / assignee; unioned + deduped) → permission filter (recipients must hold non-none access to the routed page — same effective map) → notification record with `recipientUserIds` (dedup-guarded, never-throw delivery). Read side (M9 rule, extended): directed match now also hits `recipientUserIds` and `employeeId === viewer.linkedEmployeeId` — the M9-documented employee/user namespace gap is closed for linked users. Consumers today: organization move + employee move events (old + new chain managers notified through the router, never hardcoded). Existing emitters untouched; polling architecture untouched.

## 12. Database changes

Four NEW RTDB nodes, created lazily on first write (RTDB is schemaless — **no migration needed, no migration written**): `arm_erp/orgNodes`, `arm_erp/positions`, `arm_erp/userPreferences`, `arm_erp/configAuditLog`. Two OPTIONAL fields on existing records, written only through the new admin APIs: `employees.orgNodeId`, `users.positionId` / `users.linkedEmployeeId`. No existing node, field, or record was transformed or deleted; reads without the new fields behave exactly as before.

## 13. Migration details

None required (see §12). Backward compatibility verified by tests: legacy string permissions, maps predating new pages, users without positions/linkage, notifications without recipientUserIds — all resolve identically to pre-M10.

## 14. Security model

- Every new endpoint: JWT authentication (middleware + `requireAuth`/`verifyPermission`) + page-level permission + action-level checks (`organization` create/update/delete) — UI hiding is never the control.
- User preferences: self-only (identity from token), whitelisted shape, array/size caps.
- Employee listing: field stripping (M9) THEN scope filtering (M10) — both server-side.
- Position templates structurally validated before storage; corrupt templates can't enter the resolver chain; position deletion blocked while users hold it.
- Org mutations: cycle/depth/status validation, one-company rule, delete blocked for non-empty nodes, impact preview before moves.
- Client/server permission parity maintained (auth/me + login return the position template; same resolver both sides).

## 15. Audit behavior

Reusing `writeAudit` → `arm_erp/configAuditLog`: org node create/update/**move** (with impact counts), delete; employee org moves (before/after node); position create/update/delete; user position assignment + employee linking (before/after); **permission saves with an exact before/after diff** (change-preview data). User personalization is NOT audited (no security relevance — documented). Historical records are never rewritten by any of these flows.

## 16. Tests added (85)

- **A Organization hierarchy** (org-graph, 15): structure/ordering, nesting, cycle quarantine, move validation (self/subtree/missing/archived/depth), manager chain, membership, impact preview, employee-move patch = orgNodeId only.
- **B Permission inheritance** (positions, 10): template parsing/validation; role < position < stored; stored beats template both directions; absent template = legacy-identical.
- **C Data scope** (data-scope, 13): all six scopes; admin bypass; **employee move changes scope automatically**; fail-closed without linkage; server-side filtering.
- **D Personalization** (15): order persistence, permission-first reconciliation, revocation never resurrects, widget order/visibility/defaults, reset, isolation, sanitization.
- **E Security** (section-permissions, 18): section page-gate/override/inherit, invalid overrides ignored, fail-closed; scope carrier round-trip + invalid-scope drop; safe defaults for the new page (incl. legacy stored maps); explain/parity; diff classification.
- **F Notification routing** (routing, 14): five recipient dimensions, dedup, permission filtering, routed/linkage directed matching, legacy semantics preserved, content gate, admin bypass.
- **G Historical integrity**: embedded in org-graph (move patch) — snapshots/denormalized strings untouched by construction.

## 17. Verification results

| Gate | Baseline (pre-M10) | After M10 | New errors |
|---|---|---|---|
| `npx tsc --noEmit` | 20 errors / 6 pre-existing files | 20 errors / same 6 files | **0** |
| `npm run lint` | 559 errors / 11,295 warnings | 559 errors / 11,295 warnings | **0** |
| `npm test` | 684 tests, 683 pass, 1 fail (env) | 769 tests, 768 pass, 1 fail (same env) | **0** (85 new, all passing) |

The single failing test is the documented pre-existing environmental failure (`quality-migration.test.ts` — `JWT_SECRET` missing at module load), identical before and after.

## 18. Baseline comparison

Zero new errors on all three gates (see §17). No legacy error was "fixed" to make the milestone green; the pre-existing failures remain untouched by decision.

## 19. Runtime verification (read-only, per project convention)

Against the live dev server (production Firebase — no writes exercised, following the Milestone 3 precedent; no login attempts, so the real admin account's rate limiter was never touched):
- `GET /` → 200 (SPA compiles and serves with all M10 client changes).
- `GET /api/health` → ok, Firebase connected.
- `GET /api/user-preferences`, `/api/organization`, `/api/positions` without auth → **401** (middleware + auth gates hold).
- Dev-server compile log: no errors (only pre-existing React Flow warnings from the workflow designer page).

## 20. Deviations

- Sidebar reordering uses arrow buttons rather than drag/drop — the milestone explicitly allows "drag/drop or equivalent"; arrows are mobile/RTL-safe and testable. A drag layer can be added later without touching the persistence model.
- The User-Access tab calls `/api/dashboard/users/[id]` (controlPanel-edit gated) for position/linking updates. With the default admin-only organization grant this is invisible; if organization is ever granted to non-admins without controlPanel, that tab's saves will 403 (graceful error shown).
- `assigned` scope resolves from caller-supplied assignment pairs; no assignment-bearing module feeds it yet (employees route passes none) — the engine supports it, tests cover it.

## 21. Known limitations (explicit)

- **Section permissions: FOUNDATION ONLY — NOT IMPLEMENTED in any page** (registry + resolver + SectionGate + tests exist; no page renders through them).
- Data-scope enforcement is wired into `GET /api/employees` only; every other list route still returns all rows to page-permitted users (by design — foundation; per-route adoption is future work).
- Explainable authorization is a pure layer + permission-save diff data; the admin-facing Simulator/Inspector UI is future work.
- Notification routing is consumed only by organization events; migrating existing emitters to the router is future work (their behavior is preserved).
- Position templates include page levels (+actions if authored via API); the dialog editor edits levels only.
- `employee-360` still computes all sections (section gating not wired there).
- The M9 duplicate broadcast store (`erp/notifications` vs `arm_erp/notifications`) is untouched.

## 22. Untouched modules (explicit list)

Attendance engine/results/KPI, biometric, HR deductions, quality deductions, KPI engine/formulas/dashboard settings, month close/snapshots, follow-ups, CAPA, complaints, risk center, travel, requests workflow, rules engine (automation), deduction rules, knowledge base, reports architecture (M8), workflow designer, Firebase sync/settings pages, audit primitives, auth token/refresh machinery, notification polling policy, employee-360 computation, EmployeesPage UI beyond existing M9 state.

## 23. Future extension points (prepared, not built)

Permission Simulator / Effective Access Inspector / Conflict Detector UI (over `explainPageAccess`); Permission Change Preview UI (over `diffPermissionMaps` — the save API already returns the diff); Configuration Diff viewer; admin notification-routing config (Part M — the route shape is serializable config); read-side notification scope filtering; report authorization primitives consuming scope + org hierarchy; employee accounts (Employee → User → Position flow — linkage field ready); section wiring for Employee 360; drag-and-drop sidebar layer.

## 24. Confirmation that Attendance was NOT implemented

No Daily/Monthly Fingerprint, no attendance engine work, no deductions, no payroll, no employee login/self-service, no KPI changes. The attendance module's code was neither modified nor invoked beyond reading existing test baselines.

## 25. HARD STOP confirmation

Milestone 10 ends here: organization + access-control + data-scope + personal-workspace + notification-routing foundations, tests, and this verification report. **Attendance and Milestone 11 were NOT started.**
