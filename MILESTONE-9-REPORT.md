# ARM ERP — Milestone 9 Technical Report
## Enterprise Notification Engine & Polling Hardening + Granular Access Control Foundation

---

## 1. Audit findings

**Existing and correct**
- Permission model already supports page + action granularity: `PagePermission { level: none/read/edit, actions: {create,update,delete,export,approve,upload,override} }` (`src/config/permissions.ts`)
- `resolveEffectivePermissions` — the SINGLE resolution rule (role preset + per-user stored overrides) shared by client `AuthContext`, server `verifyPermission`, and the Control Panel editor
- `usePermissions` hook (canView/canEdit/canDoAction/visiblePages), PageRouter page-level guard with AccessDenied screen, Sidebar filtering via `visiblePages`
- Quality-kpi pages already gate action buttons (e.g. `ObservationsPage` passes `canApprove` down to rows)
- `AppNotification` schema already carries priority, status lifecycle, source entity (`sourceModule`/`sourceRecordId`), deep-link (`targetPage`/`actionUrl`), timestamps — reused unchanged
- Token refresh: single-use rotation, mutex-deduplicated, 12-minute proactive timer, 401 auto-retry in `apiFetch`
- Server-side action enforcement via `verifyPermission` on all notification mutation routes

**Existing but incomplete**
- `GET /api/notifications` computed `isManagerOrAbove` but never used it (dead code) — broadcast visibility intent was never wired
- No permission-aware routing: a recipient's access to the notification's referenced page/entity was never checked
- Deduplication bypassed: `createSmartNotification` skipped dedup when `employeeId` was null; `fireQualityNotification` when `sourceRecordId` was null; `POST /api/follow-ups` used raw `createRecord` with NO dedup at all
- Ownership logic triplicated with drift across list route / `[id]` route / notification-stats

**Existing but inconsistent**
- Firebase real-time listener subscribed to `arm_erp/notifications` while the broadcast API writes to `erp/notifications` — real-time delivery never fired, making polling the only working mechanism
- Directed notifications store EMPLOYEE ids in `employeeId`/`assignedTo`, but inboxes are keyed by USER ids

**Missing**
- No `PermissionGate` component primitive
- No field-level permission concept; `GET /api/employees` returned `mobile` to ANY authenticated user; `employee-360` returned `mobile` to anyone with view access
- No data-scope concept (documented extension point only)

**Duplicate**
- Two refresh-token implementations (AuthContext + query-provider) — both with their own mutex; left as-is (functional, out of scope)
- Two notification stores (Firebase RTDB broadcast + notifications collection) — the Firebase one now feeds the same bell via the fixed listener path

**Unsafe**
- Employee personal contact data (mobile) shipped to every authenticated user
- The GET ownership filter compared employee ids to user ids (never true), so non-admin inboxes were effectively empty — admin saw everything

---

## 2. Root cause of Admin-only notifications

Two compounding defects:

1. **Broadcast notifications were admin-only by dead code.** All quality-event notifications (observation awaiting approval / approved / rejected, month closed / reopened) and critical follow-up alerts are broadcast-style (`employeeId: null, assignedTo: null`). The GET route's ownership filter (`r.employeeId === auth.userId || r.assignedTo === auth.userId`) removed them for every non-admin. The `isManagerOrAbove` variable — the evident intent to give staff roles broadcast visibility — was computed and never used.
2. **Namespace mismatch for directed notifications.** Business routes (follow-ups, CAPA, complaints, HR/quality→CAPA) store EMPLOYEE ids in `employeeId`/`assignedTo`, compared against USER ids. The system has NO employee↔user linkage (users: id/email/role/permissions; employees: id/code/name/department — no cross-reference), so the comparison never matched. Only the admin bypass escaped both defects.

**Fix:** `src/lib/notifications/recipient-visibility.ts` — the single server-side rule:
- Admin bypass preserved
- Content permission gate: the notification's `targetPage` (with category/module fallbacks) maps to a page permission key; level `none` → hidden for EVERYONE below admin (Part B — no information leak through notifications)
- Directed: exact `employeeId`/`assignedTo` match against the caller's userId (still gated by content permission)
- Broadcast: staff roles (manager/quality/hr — wiring the dead variable's intent) that also pass the content gate
- Uses the SAME effective permission map from `resolveEffectivePermissions` — no second resolver

---

## 3. Root cause of repeated idle polling

- `AuthContext.tsx` ran `setInterval(refreshUser, 60000)` — GET `/api/auth/me` every 60s while logged in, unconditionally (even tab hidden). Purpose was only to pick up permission/suspension UI changes (both are enforced server-side per-request anyway).
- `NotificationContext.tsx` ran `setInterval(refresh, 45000)` — GET `/api/notifications?limit=50&status=unread...` every 45s unconditionally, even with the (broken) real-time listener active and while hidden.
- No `visibilitychange` handling existed anywhere; both loops aligned into the observed ~minute cadence.

---

## 4. Notification architecture changes

- NEW `src/lib/notifications/recipient-visibility.ts` — single recipient + permission rule (registry, page-key resolution, `canSeeNotification`, `filterVisibleNotifications`)
- NEW `src/lib/notifications/dedup.ts` — pure dedup predicates shared by `createSmartNotification` (key: title+employeeId+sourceRecordId) and `fireQualityNotification` (key: title+sourceRecordId, title-only fallback for entity-less broadcasts such as month close)
- `createSmartNotification` dedup now covers broadcast notifications carrying a `sourceRecordId` (previously bypassed)
- `fireQualityNotification` dedups entity-less events by title (month close/reopen titles embed the month key, so repeats are retries)
- `POST /api/follow-ups` uses `createSmartNotification` for all three notifications (gains dedup + targetPage auto-resolution)
- Notification schema unchanged (Part C: equivalent fields already existed)

## 5. Recipient-resolution rules implemented

| Rule | Behavior |
|---|---|
| Admin | Sees all (existing bypass preserved) |
| Content gate | Everyone below admin: governing page key (`targetPage` → category → sourceModule) must resolve to level ≠ `none` |
| Directed | `employeeId === userId` OR `assignedTo === userId`, still content-gated |
| Broadcast | Staff roles (manager/quality/hr) + content gate |

Documented gap (NOT fabricated): no employee↔user linkage exists, so subject-employee delivery cannot be resolved today; the extension point is documented in `recipient-visibility.ts`.

## 6. Permission architecture changes

- `src/config/permissions.ts` extended (backward compatible — presets untouched):
  - `FieldAccess = 'hidden' | 'read-only' | 'editable'`
  - `SENSITIVE_FIELDS` registry — only REAL fields (`employees.mobile`; salary does not exist in this system — payroll is a future milestone)
  - `resolveFieldAccess(permissions, page, field)` tri-state resolution deriving from the same page entries
  - `stripRestrictedFields(record, page, permissions)` server-side serializer
  - Data-scope extension point documented (Part K — no scope rules invented)
- `usePermissions` gains `getFieldAccess` / `canSeeField` / `canEditField`
- NEW `src/components/shared/PermissionGate.tsx` — `<PermissionGate page action>` and `<FieldGate page field>`, thin wrappers over `usePermissions` (no duplicate mechanism)

## 7. Page / action / field-level access changes

- Page-level: unchanged (PageRouter guard + Sidebar filtering already correct)
- Action/button: already gated via `canXxx` in pages (verified in `ObservationsPage`); `PermissionGate` now provides the centralized primitive for future use
- Field-level: `EmployeesPage` mobile column renders `—` for users without edit; `Employee360Page` mobile hides automatically because the backend now sends `null`

## 8. Backend authorization changes

- `GET /api/notifications`, `GET/PATCH/DELETE /api/notifications/[id]`, `GET /api/notification-stats` — all three now enforce the SAME `canSeeNotification` rule (replaces drifted triplicated filters)
- `GET /api/employees` — strips `mobile` server-side for viewers without employees edit (`stripRestrictedFields`)
- `GET /api/employee-360/[id]` — returns `mobile: null` when field access is `hidden`
- Restricted data no longer reaches the browser (Part J) — frontend hiding is UX only

## 9. Polling behavior — before / after

| Aspect | Before | After |
|---|---|---|
| `/api/auth/me` | every 60s, always | every 5 min, visible only; + once on foreground return when stale (>5 min) |
| `/api/notifications` | every 45s, always | every 45s (reliability preserved), visible only; + once on foreground return when stale (>30 s) |
| Hidden tab | both loops kept firing | zero polling |
| Foreground return | nothing (loops just continued) | one immediate refresh per loop when stale |
| Token refresh (12-min timer) | independent | unchanged, still independent |
| Real-time | listener on wrong path (`arm_erp/`) — never fired | fixed to `erp/notifications` (the path the API writes) — listener now delivers, poll remains fallback |

Idle visible-tab traffic: `/auth/me` reduced 60s→300s; hidden tab: both loops eliminated. Decisions live in pure helpers (`src/lib/polling-policy.ts`) shared by both loops and unit-tested.

## 10. Files changed

**New**
- `src/lib/notifications/recipient-visibility.ts`
- `src/lib/notifications/dedup.ts`
- `src/lib/polling-policy.ts`
- `src/components/shared/PermissionGate.tsx`
- Tests: `src/lib/notifications/__tests__/recipient-visibility.test.ts`, `src/lib/notifications/__tests__/dedup.test.ts`, `src/lib/permissions/__tests__/field-permissions.test.ts`, `src/lib/__tests__/polling-policy.test.ts`

**Modified**
- `src/app/api/notifications/route.ts` (list visibility)
- `src/app/api/notifications/[id]/route.ts` (shared visibility)
- `src/app/api/notification-stats/route.ts` (shared visibility)
- `src/app/api/follow-ups/route.ts` (deduped creation)
- `src/app/api/employees/route.ts` (field stripping)
- `src/app/api/employee-360/[id]/route.ts` (field stripping)
- `src/lib/rules-engine.ts` (shared dedup predicate)
- `src/lib/notifications/quality-events.ts` (shared dedup predicate + fallback)
- `src/config/permissions.ts` (field-level + scope docs)
- `src/hooks/usePermissions.ts` (field accessors)
- `src/contexts/AuthContext.tsx` (visibility-aware refresh)
- `src/contexts/NotificationContext.tsx` (visibility-aware poll, foreground recovery, listener path fix)
- `src/components/pages/EmployeesPage.tsx` (mobile column gate)

## 11. Files intentionally untouched

- All KPI engine/scoring, quality scoring, attendance, payroll/salary modules (future milestones)
- `src/lib/verify-permission.ts` / `src/lib/auth.ts` / auth API routes (architecture preserved)
- `src/lib/query-provider.tsx` React Query defaults (refetchOnWindowFocus is desired foreground recovery; staleTime already bounds it)
- Duplicate refresh-token implementations (functional; consolidation out of scope)
- Pre-existing legacy-error files listed in §14

## 12. Tests added (51, all passing)

- **Notification routing** (24): admin bypass; manager/quality receive observation broadcasts (previously admin-only); HR blocked from observation broadcasts (observations: none — Part B); quality blocked from HR broadcasts; regular users receive no broadcasts; directed recipient sees own; non-recipient staff blocked; directed recipient blocked when governing page denied; employeeId-match resolution; list-filter matrices
- **Permission enforcement** (15): tri-state resolution (none/read/edit × sensitive/normal); manager hidden from mobile; HR/admin editable; `stripRestrictedFields` removes mobile for read-level viewers, keeps for edit-level, pass-through identity; registry sanity; preset backward-compatibility
- **Polling** (12): hidden tab never polls; fresh-data skip; interval-elapsed poll; foreground refresh only when stale; cadence anchors (45s notifications, 5-min auth, 30s stale threshold, independence)
- **Dedup** (included above): repeat-in-window duplicate detected; distinct records not suppressed; broadcast-with-sourceRecordId (previously bypassed) deduped; out-of-window allowed; month-close title fallback

## 13. Verification results

- `npx tsc --noEmit` — **zero errors in milestone files**. 20 remaining errors are pre-existing in untouched files (verified none are in the changed-file list)
- `npm run lint` — no new errors introduced (changed files linted against their `HEAD` versions: identical error counts and categories; the 559-error baseline is legacy)
- `npm test` — **683 / 684 pass**, including all 51 new tests. The single failure (`quality-migration.test.ts`) is a pre-existing **environmental** failure: its import chain loads `@/lib/auth`, which throws at module load without `JWT_SECRET` (chain: quality-migration → `api/quality-audit-log/route` → `verifyPermission` → `auth.ts`; none of these were modified)

## 14. Remaining baseline errors (pre-existing, untouched)

- `src/components/pages/quality-kpi/EmployeeQualityKpiPanel.tsx` (7)
- `src/lib/kpi-dashboard/__tests__/kpi-dashboard.test.ts` (7)
- `src/lib/metrics/__tests__/riskMetrics.test.ts` (1)
- `src/lib/quality-migration/index.ts` (1)
- `src/workflow/*` (3) — plus the repo-wide legacy lint baseline

## 15. Security considerations

- Backend remains authoritative for reads, mutations, and field visibility
- No client-provided userId/role/permission is trusted anywhere in the new code
- Content gate prevents notification-borne information leaks about pages/entities the recipient cannot access (both list and by-id routes)
- `mobile` is stripped server-side — never merely hidden in the UI
- SPA has no per-page URLs (currentPage is store state), so "direct URL access" reduces to PageRouter's guard; navigation from the bell passes through it unchanged
- Admin bypass preserved exactly where previously defined (verifyPermission, visibility rule)

## 16. Future extension points (documented in code, not implemented)

- Employee↔user linkage → subject-employee directed delivery (`recipient-visibility.ts`)
- Data scope on `PagePermission` (`config/permissions.ts` §DATA SCOPE)
- Admin Notification Configuration: the routing registry in `recipient-visibility.ts` is the seed (per-type audience/priority/enable/retention/deep-link), serializable for a future admin screen
- Sensitive-field registry growth (e.g. salary when payroll lands)

## 17. Milestone 10 confirmation

No Milestone 10 work was performed. No unrelated modules were modified. STOP after this report.
