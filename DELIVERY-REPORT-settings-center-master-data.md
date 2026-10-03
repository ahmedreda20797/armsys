# QNALYS — DELIVERY REPORT
## Unified Settings Center + Configurable Master Data System
### (Quality Observation Categories — first Master Data domain)

Date: 2026-10-01 · Branch: main (working tree)

---

## PART 1 — SETTINGS

### 1. Complete inventory of existing Settings discovered (pre-implementation)

| # | Surface | File | Scope | Source of truth |
|---|---------|------|-------|-----------------|
| 1 | Settings page (language, theme) | `src/components/pages/SettingsPage.tsx` | User-specific | localStorage / next-themes |
| 2 | Control Panel — Users tab + dialogs | `src/components/pages/ControlPanelPage.tsx` | System | `/api/dashboard/users*` → `users` |
| 3 | Control Panel — Permissions tab | `src/components/permissions/PermissionManagerConsole.tsx` | System | `GET/PUT /api/dashboard/users/{id}/permissions`, audited |
| 4 | Control Panel — Activity Logs / Sessions tabs | `ControlPanelPage.tsx` | Read-only | `/api/activity-logs(/online)` |
| 5 | Performance Engine Settings (quality settings, KPI weights, HR settings (form-only, not persisted — pre-existing), trend calc, automation switch) | `quality-kpi/PerformanceEngineSettingsPage.tsx` | System | `/api/kpi-settings` (`kpiSettings/singleton`), `/api/kpi-schemes`, `/api/rules/stats` (`systemSettings/automation`) |
| 6 | Organization & positions (+permission templates) | `organization/OrganizationPage.tsx` | System | `/api/organization*`, `/api/positions` (`orgNodes`, `positions`) |
| 7 | Rules & Automation engine | `RulesEnginePage.tsx` | System | `/api/rules*` (`automationRules`) |
| 8 | Deduction Rules | `RulesPage.tsx` | System | `/api/deduction-rules` (`deductionRules`) |
| 9 | Month Close | `quality-kpi/MonthClosePage.tsx` | System (ops) | `/api/month-snapshots/*` |
| 10 | Workflow Designer | `workflow-designer/WorkflowDesignerPage.tsx` | Design-time | localStorage only (unchanged) |
| 11 | Quality Audit Log (config audit) | `quality-kpi/QualityAuditLogPage.tsx` | Read-only | `/api/quality-audit-log` (`qualityAuditLog`) |
| 12 | **Observation Categories manager (already DB-driven)** | `quality-kpi/ObservationCategoriesPage.tsx` (replaced) | System | `/api/observation-categories` (`observationCategories`) |
| 13 | Observation Templates manager | `quality-kpi/ObservationTemplatesPage.tsx` | System | `/api/observation-templates` |
| 14 | Profile page (self-service) | `ProfilePage.tsx` | User-specific | `/api/profile` |
| 15 | Personal workspace prefs (sidebar, dashboard widgets, favorites/pins, UI flags) | `Sidebar.tsx`, `HomePage.tsx`, `NavigationMarks.tsx`, `AttentionPanel.tsx` | User-specific | `/api/user-preferences` (`userPreferences/{uid}`) |
| 16 | AI provider settings — **API only, no UI (pre-existing; Phase 6.10 pending upstream)** | `api/ai/provider-settings` + `lib/ai/gateway/provider-settings.ts` | System (admin) | `aiProviderSettings/singleton`, audited |
| 17 | Legacy orphaned `KpiSettingsPage.tsx` (unrouted) | quality-kpi/KpiSettingsPage.tsx | — | same `/api/kpi-settings` (left untouched) |

### 2. Consolidation performed
- `SettingsPage.tsx` rebuilt as the **one centralized Settings Center** (`§SETTINGS-CENTER`) with internal section navigation:
  - **عام / General** — personal preferences (embedded; behavior unchanged).
  - **البيانات المرجعية والقوائم النظامية / Master Data & System Lists** — embedded Master Data framework (new).
  - **Linked sections** to the canonical config pages (rendered via `navigateTo`, NOT re-implemented): مركز التحكم (users/permissions/sessions/logs), الهيكل التنظيمي, إعدادات محرك الأداء, الأتمتة والقواعد, قواعد الخصم, إغلاق الشهر, سجل مراجعة الجودة, مصمم المسارات. Each link is filtered by the viewer's real page permissions.
- The legacy `observationCategories` page id **routes INTO the Settings Center** deep-linked to its Master Data domain (`src/app/page.tsx`), preserving the registry entry, permission key `observationCategories`, availableActions and all existing grants.
- The old standalone `ObservationCategoriesPage.tsx` was **deleted** (no parallel settings UI remains).

### 3. Final Settings structure
```
Settings (id: settings — the ONE center)
├── عام (General)                        — embedded, personal
├── البيانات المرجعية والقوائم النظامية   — embedded, Master Data
│     └── تصنيفات ملاحظات الجودة (workspace)
├── مركز التحكم (Users & Permissions)    → canonical page
├── الهيكل التنظيمي (Organization)       → canonical page
├── إعدادات محرك الأداء (Quality+KPI)    → canonical page
├── الأتمتة والقواعد (Automation)        → canonical page
├── قواعد الخصم (Deduction Rules)        → canonical page
├── إغلاق الشهر (Month Close)            → canonical page
├── سجل مراجعة الجودة (Audit)            → canonical page
└── مصمم المسارات (Workflow Designer)    → canonical page
```
This mirrors the actual existing architecture (registered pages with per-page permission keys — the architecture the permission regression suites pin) rather than an artificial re-grouping.

### 4–8. Sources of truth, duplicates, APIs, Firebase paths
- **Zero new Firebase configuration paths.** Master Data for categories lives in the EXISTING `arm_erp/observationCategories` table.
- **Zero new API families.** The EXISTING `/api/observation-categories` routes were extended in place (GET/POST/PUT-reorder on the collection route; PUT/DELETE on `[id]`).
- Existing settings read/write exactly the same sources as before (verified by the untouched route-permission regression suites: `m02`/`m021` pass).
- User preferences remain user-specific and untouched (`userPreferences/{uid}`); nothing personal was moved into system settings; transactional data untouched.

---

## PART 2 — MASTER DATA

### 9. Architecture
- **Domain registry** (single, reusable): `src/lib/master-data/registry.ts` — declares `MASTER_DATA_DOMAINS` with `status: 'available' | 'planned'`. Adding a future domain = one registry entry + one workspace component. No over-engineered generic framework.
- **Canonical provider** for the quality domain: `src/lib/observation-categories/` (`index.ts` — data/migration; `presentation.ts` — client-safe pure helpers: `sortCategories`, `isCategoryActive`, `categoryDisplayName`, `selectorCategories`).
- **One presentation rule** for every consumer: names render as `nameEn` in EN UI / `name` (Arabic) otherwise — never record ids, never internal keys (the `key` code column exists ONLY inside the admin management table, per spec §43).

### 10. Quality Observation Categories implementation
- Management workspace: `src/components/pages/settings/ObservationCategoriesWorkspace.tsx`
  - Professional table (§43): الاسم/Name · الكود/Code · التأثير/Impact · الحالة/Status · الاستخدام/Usage · آخر تعديل/Last updated · الإجراءات/Actions.
  - Search (name/code/nameEn), active/inactive filter, add, edit, deactivate/reactivate, reorder (up/down → batched `PUT {reorder}`), safe delete.
  - Create/Edit dialog (§44): Arabic name*, English name*, internal code (create-only, validated `^[a-z0-9_-]{2,64}$`), impact (POSITIVE/NEGATIVE/NEUTRAL), default points, weight, priority, color, display order, active switch.
- Data model extended (`src/types/quality-kpi.ts`): `nameEn?`, `isActive?`, `sortOrder?`, `impact?` + `CategoryImpact` type. `isBonusDefault` stays synchronized (`impact === 'POSITIVE'`) so the existing scoring engine is untouched.

### 11–13. Migration (executed AND verified against the REAL database)
`ensureObservationCategoryMasterData()` — idempotent, additive-only:
- Fresh install → creates the full 18-category vocabulary.
- Existing install → backfills ONLY missing `nameEn/isActive/sortOrder/impact`; applies the two sanctioned renames **only when the record still carries the exact legacy name**; inserts missing additions by key after the max sortOrder.
- **Live result verified on the production RTDB:** 18 records — the 10 existing (all still ACTIVE, `مخالفة أمان` untouched and active with its 13 historical observations) + the 8 requested additions; renames applied: `تأخر متابعة → متابعة`, `أداء ممتاز → أداء`; sortOrder 1..18; every record has nameEn; nothing deactivated, deleted or overwritten.
- **Idempotency:** second ensure run performs ZERO writes (unit-tested against the in-memory harness AND inherent in the real-data run — the workspace GET ran multiple times during verification with no duplicate creation).

### 14–16. Historical data, stable identity
- Observations store `categoryId` + **frozen** `categoryName`/`categoryWeight` at creation (pre-existing design). Renames therefore affect only NEW observations; every historical observation continues to display its original label. No "Unknown Category" fallbacks introduced.
- Historical observations referencing a now-deactivated category remain fully readable: filters, dashboards and edit dialogs still resolve all categories (the KPI dashboard id→name map includes inactive categories; the observations edit dialog lists all categories so an existing record keeps its value; switching *to* an inactive category is blocked server-side).
- Stable identity = RTDB record id + `key` code. Renames reused the same records (same ids/keys) — no new records were created for متابعة/أداء.

### 17. Impact model
- Category-level `impact` (POSITIVE/NEGATIVE/NEUTRAL) is independently configurable; the observation-level bonus/deduction remains a per-record choice with the category providing the default — matching the existing engine. Migration mapped `isBonusDefault: true → POSITIVE`, `false → NEGATIVE`.
- No deduction/reward engine was implemented; no point values were invented — the 8 new categories ship with `defaultPointValue: 0` for the System Owner to configure.

### 18. Quality engine compatibility
`kpiMetrics.computeEmployeeScore`, monthly snapshots, approval flow and KPI quality component are untouched — the Master Data layer supplies vocabulary only. (The only scoring-adjacent behavior: new observations now default bonus per impact — identical to the old `isBonusDefault` semantics.)

### 19–22. Active/inactive, sort, duplicates, usage, audit, cache
- Deactivate → hidden from new-observation selectors (client-side AND fail-closed server-side on observation create and on category *switch*); reappear on reactivate. Deletion of a referenced category is **rejected with its usage count** (observations AND templates checked); unreferenced categories may still be hard-deleted (existing behavior preserved).
- Sort order is canonical (`sortOrder` then Arabic name), used by the workspace, observation create dialog, edit dialog, templates dialog, home quick action.
- Duplicate prevention: unique normalized `key` across ALL records; unique Arabic name among ACTIVE records; impact validated against the enum; all server-side.
- Usage counts: `GET ?withUsage=1` computes counts from the canonical `qualityObservations` table in one grouped pass (manager UI only; no N+1).
- Audit: create/update/deactivate/reactivate/reorder/delete all write to the existing `qualityAuditLog` via the existing `writeAudit` primitive (verified live in the browser: «تعطيل تصنيف: تجاهل العميل…» and «إعادة تفعيل تصنيف…» both appeared in سجل مراجعة الجودة with actor + timestamp).
- Cache: existing TanStack keys (`['kpi','categories']` + `['kpi','categories','usage']`) invalidated by every mutation; server-side per-table TTL cache is write-invalidated by `db.ts` helpers. No new cache was created.

---

## PART 3 — PERMISSIONS

- Default management permission remains the existing canonical model for page `observationCategories` (actions create/update/delete): System Owner by unconditional bypass; manager role by existing preset; quality role read; HR/user none. **No new permission infrastructure, no second Master Data owner role, no hard-coded `role === 'admin'` check in new code** — all gating goes through `usePermissions().canViewPage` (client) and `verifyPermission(request,'observationCategories', action)` (server).
- Delegable as before through the existing Permission Manager (page + actions grant). Existing grants keep working (registry entry unchanged).
- Server-side chain on every mutation: JWT auth → suspension check → effective-permission resolution → page+action gate → input validation (schema, uniqueness, enum) → mutation → audit. Verified by tests: user role → 403 on GET/POST; admin/manager allowed; tampered/absent tokens → 401.

---

## PART 4 — LOCALIZATION
- All new UI is Arabic-first with `<T>`/`translateUIText` + en-map entries added for every new Arabic string (verified: no duplicate en-map keys; the settings-consolidation test pins the EN mapping of every category name).
- Verified live in the browser in BOTH locales: settings navigation, domain list (including «قيد التهيئة/Planned»), table headers (الاسم…/Name…), status badges (نشط·معطّل/Active·Inactive), impact badges (إيجابي·سلبي·محايد/Negative…), usage text (183 ملاحظة / 183 observations), dialogs, confirmations (§45 text verbatim), toasts, empty states, validation messages.
- RTL/LTR: the Settings Center nav and workspace use logical properties (`start/end`), Radix portals are direction-aware via the existing `RtlDirectionProvider`; verified visually in Arabic RTL (default) and English LTR.

---

## PART 5 — QUALITY
- The "ملاحظة جودة جديدة" form loads categories from the Master Data source (`useObservationCategories` → `selectorCategories`): active only, sortOrder order, locale-aware labels. Verified live: with `تجاهل العميل` deactivated the form offered exactly 17 options in canonical order; after reactivation it returns.
- No second hard-coded category source exists anywhere (static test guard: the seed keys are defined ONLY in `src/lib/observation-categories/index.ts`; consumers contain no category vocabulary). The old page file was deleted.
- Home quick-action observation form, templates dialog, KPI dashboard distribution map: same pipeline (active-filter + order + nameEn), with dashboards keeping inactive categories resolvable for history.

---

## PART 6 — VALIDATION

- **Tests added** (32 new):
  - `src/lib/observation-categories/__tests__/master-data.test.ts` — 23 tests: bootstrap completeness, sortOrder integrity, idempotency (zero writes on 2nd run), legacy backfill, exact-legacy rename semantics, user-renamed record protection, never-deactivate guarantee, additions insertion/no duplicates, 401/403/200 permission matrix, duplicate key/name rejection, impact→isBonusDefault sync, deactivate/reactivate + audit, reorder + audit + partial-list rejection, referential delete guard (observations/templates), usage counts, inactive-category enforcement on observation create (rejected when off, 201 when active), `sortCategories` ordering, static permission-contract pins.
  - `src/lib/__tests__/settings-consolidation.test.ts` — 9 guards: one canonical vocabulary file, no hard-coded lists in consumers, legacy page removed + route deep-links into the center, one Settings Center, one Master Data registry, consumer selector-pipeline wiring, activation/sort contract in source, full AR→EN category coverage, server-side inactive guard present.
- **Full suite:** 2695/2696 + 45/47 pass. The 3 remaining failures are **pre-existing at HEAD** (verified by running them in a clean worktree of commit 03111bb): `global-search` EmployeesPage highlight assertion, and the two `download-opt` notification-stats contract checks. Not touched by this task.
- **TypeScript:** `npx tsc --noEmit` — clean.
- **ESLint:** changed-file set clean; repo-wide error count went DOWN (1549 → 1219) vs baseline.
- **Production build:** `next build` succeeds (route table generated; verified via `BUILD_DIST_DIR` isolation because a protected local process holds `.next/standalone`).
- **Manual browser verification (§59)** — performed on a live dev server against the REAL database with a temporary admin account (created for the session and **deleted afterwards**, users back to 18): login ✓; one Settings Center ✓; all prior settings reachable ✓; Master Data ✓; all 18 categories present and active ✓; no category auto-disabled ✓; observation form reflects active list + order ✓; deactivate → disappears from form ✓; history unaffected ✓; reactivate → returns ✓; edit dialog ✓; Arabic/English/RTL/LTR ✓; System Owner access ✓; audit trail entries ✓; cache refresh (invalidation) observed ✓; no duplicate Settings UI ✓.
- **Migration performed:** YES — the additive master-data migration ran against the real `observationCategories` table (details in §11–13 above). It is idempotent and will no-op on subsequent runs/deploys.

---

## PART 7 — ARCHITECTURAL GUARANTEE

46. Explicit confirmation:
    - **ONE SETTINGS CENTER** — the rebuilt `settings` page; the legacy categories route deep-links into it; no other settings hub was created.
    - **ONE SOURCE OF TRUTH PER SETTING** — every surface keeps its original store/API; Master Data categories live only in `observationCategories` + `/api/observation-categories`.
    - **ZERO DUPLICATION** — no duplicate APIs, no duplicate Firebase paths, no parallel settings UI, no second audit/cache/permission system, no hard-coded category lists in consumers.

47. Remaining legacy structures (intentional): ControlPanel/Organization/RulesEngine/Rules/MonthClose/QualityAuditLog/WorkflowDesigner remain canonical *pages* (the app's registered-page permission architecture; merging them into one component would rewrite the permission model the regression suites pin — out of scope per §60). `ObservationTemplatesPage` remains a quality-side manager (not required by this task; a natural future Master Data domain). The orphaned `KpiSettingsPage.tsx` and UI-less AI provider settings API are pre-existing and untouched. Known pre-existing auth gaps on `/api/deduction-rules/[id]` and `/api/rules/[id]` (requireAuth-only) were reported by the inventory but left untouched (out of scope).

48. Migration performed: **yes** — one idempotent, additive master-data migration (see Part 2).

49. Nothing existing was silently disabled, deleted, overwritten, or duplicated. The only deletions: the superseded `ObservationCategoriesPage.tsx` (its function moved into the Settings Center; registry/permissions preserved) and the temporary verification admin account (removed with its session).

---

## KEY FILES
- Data: `src/lib/observation-categories/index.ts` (canonical vocabulary + migration), `presentation.ts`
- API: `src/app/api/observation-categories/route.ts` (GET+usage, POST, PUT reorder), `[id]/route.ts` (PUT incl. deactivate, DELETE with referential guard)
- Types: `src/types/quality-kpi.ts` (`CategoryImpact`, extended `ObservationCategory`)
- UI: `src/components/pages/SettingsPage.tsx` (Settings Center), `src/components/pages/settings/MasterDataSection.tsx`, `src/components/pages/settings/ObservationCategoriesWorkspace.tsx`
- Registry: `src/lib/master-data/registry.ts`
- Consumers updated: `ObservationsPage.tsx`, `ObservationTemplatesPage.tsx`, `HomeQuickActionHost.tsx`, `inline-forms.tsx`, `KpiDashboardPage.tsx`
- Router/permissions: `src/app/page.tsx`, `src/config/permissions.ts` (descriptions only; keys unchanged)
- i18n: `src/lib/i18n/en-map.ts` (§SETTINGS-CENTER + §MASTER-DATA block)
- Tests: `src/lib/observation-categories/__tests__/master-data.test.ts`, `src/lib/__tests__/settings-consolidation.test.ts`
