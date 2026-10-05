# QNALYS — SETTINGS CENTER CONSOLIDATION, MASTER DATA EXPANSION & SETTINGS UX REFINEMENT — DELIVERY REPORT

Task: (1) remove Settings-only sections from the global Sidebar, (2) continue the
Master Data domains, (3) replace the oversized Settings section navigation with a
compact collapsible/drawer navigation, (4) fix the Permission Manager user-list
scroll — without rebuilding the existing Settings architecture, weakening
permissions, or touching the cache/page-state layers.

---

## 1. Global Sidebar cleanup

Audited every `APP_PAGES` entry against its implementation (config section vs
operational page). Removed from the global sidebar (canonical
`overlayOnly` mechanism — "in permissions but NOT in sidebar"):

| Page | Why configuration |
|---|---|
| `kpiSettings` (إعدادات محرك الأداء) | KPI-engine weights/config — Settings section (task §11 explicit) |
| `rules` (قواعد الخصم) | Automated-deduction-rule authoring — Settings section (§11 explicit) |
| `monthClose` (إغلاق الشهر) | Month lifecycle administration — Settings section (§11 explicit) |
| `rulesEngine` (الأتمتة والقواعد) | Automation-rule configuration — Settings section (§11 "etc.") |

Kept in the sidebar (per task §1 keep-list / operational nature): Home,
Operations Center, Daily Follow-up, Employees, Attendance, Biometric, Requests,
Quality, CAPA, Risk Center, Complaints, Observations, KPI Dashboard, KPI
Reports, **Quality Audit Log** (operational audit trail over quality
operations — monitoring, not configuration), Smart Quality Report, HR
Deductions, Travel, Reports, Quality Deductions Report, Knowledge Base,
**Control Center, Organization, Workflow Designer** (explicitly kept), Settings.
`observationCategories`/`observationTemplates` were already `overlayOnly`.

Effects verified: `visiblePages` excludes the four pages → user layouts
reconcile them away; `SidebarEditNav` cannot re-add them. The permission
registry entries, routes, API gates and Permission Manager listings are
UNTOUCHED (the server authorization profile reads `APP_PAGES` directly).
Removing a sidebar entry grants/revokes nothing.

New master-data administration gate: one new `overlayOnly` permission page
**`masterData`** (Database icon, actions create/update/delete), presets
mirroring the reference domain: admin bypass, manager edit-with-actions,
quality read, HR/user none — delegable via the existing Permission Manager.

## 2. Settings navigation redesign

`src/components/pages/settings/SettingsSectionNav.tsx` (new): ONE compact
trigger row (current section icon+title + "الأقسام" toggle) replaces the
always-visible `lg:w-64` rail. Desktop (lg+): collapsible overlay panel
anchored below the trigger — content keeps its width/height. Mobile/tablet
(<lg): internal Settings drawer anchored to the inline-start edge (dir-aware,
backdrop, ESC, ✕), closed after every selection. Section state stays exactly
where it was (`store.navParams.section` + `sanitizeSettingsSection`) — no
second state mechanism; every selection is a same-page `navigateTo('settings',
{section})`.

§ANIM-MOUNT: panels render conditionally with enter animations only and
unmount instantly on close (the codebase's §EMPLOYEE360-CLOSE doctrine) — an
AnimatePresence exit was caught in live verification finishing its animation
WITHOUT unmounting when a section-switch re-render raced it, leaving an
invisible pointer-blocking layer; the exit wait is gone.

## 3. Settings sections implemented (Master Data)

Three new DB-driven domains under Settings → Master Data, following the
observation-categories architecture exactly (own RTDB table + ONE idempotent
additive migration + shared API family + workspace):

| Domain | Table | Seeds |
|---|---|---|
| `followUpTypes` (أنواع المتابعات) | `followUpTypes` | 10 — byte-exact keys & labels of the historical lists |
| `complaintTypes` (أنواع الشكاوى) | `complaintTypes` | 6 — byte-exact |
| `requestTypes` (أنواع الطلبات) | `requestTypes` | 5 form keys + 2 read-side (`mission`, `salary_advance`) — byte-exact |

Remaining under preparation (2) — deliberately: **`dealStatuses`** and
**`travelServiceTypes`**. Audit findings (documented in the registry):
deal-status keys are structural (closure accounting keys on `completed`,
travel tabs on `upcoming ∪ in_progress`, analytics distributions); booking
service types are server-validated and projected onto per-service legacy deal
fields. A free-form list there would silently break those aggregations, so
these mount together with their engine wiring (registry §AUDITED-RESERVATION).

## 4. Remaining sections still under preparation

Same two as above (dealStatuses, travelServiceTypes) — `status: 'planned'`,
canonical §8 slot, updated bilingual descriptions.

## 5. Master Data schema / API changes

- `src/types/master-data.ts` — `MasterDataListItem` (id, schemaVersion, key,
  name/nameEn, isActive, sortOrder, createdAt/updatedAt, createdBy/updatedBy)
  — the SAME field vocabulary the reference domain uses; no second schema.
- `src/lib/master-data/simple-lists.ts` — domain registry (table + usage
  table/field + audit entity label), canonical seeds, `buildSimpleListPatch`,
  `ensureSimpleMasterData` (fresh seed / additive insert / field backfill /
  zero-write idempotency / never renames-deletes), `assertSimpleValueIsActive`.
- `src/lib/master-data/simple-list-presentation.ts` — client-safe: canonical
  sort, active-filter selector, locale label, DB→static→verbatim value
  presentation.
- **API**: `/api/master-data/[domain]` (GET + `?withUsage=1` usage counts from
  one grouped read; POST; PUT `{reorder}`) and `/api/master-data/[domain]/[id]`
  (PUT with deactivate/reactivate audit actions; DELETE with §NO-HARD-DELETE
  referential guard). Gates: `verifyPermission(request, 'masterData',
  view/create/update/delete)`; audit via `writeConfigAudit` → `configAuditLog`;
  key pattern + unique key + unique active Arabic name, server-side.
- **Deactivation contract live**: the follow-ups/complaints/requests POST+PUT
  routes reject a value whose master-data record `isActive === false`
  (deactivation guard — unknown/legacy values stay accepted; never a
  whitelist).
- Consumers: FollowUpsPage (filter=all-options incl. inactive; form=active;
  badges/labels via vocabulary), ComplaintsPage (both selects + badge label),
  RequestsPage (both form selects + labels/search/badges), shared
  inline-forms (3 quick forms). Static maps remain as fallbacks so selectors
  can never render empty; TS unions widened with `(string & {})`.
- `src/hooks/use-master-data.ts` — one cache family `['masterData', domain]`
  (+ usage variant), mutations invalidate both; `useMasterDataVocabulary`
  consumer selector.
- `src/lib/db.ts` — **§RTDB-PATCH-SEMANTICS fix in `updateRecords`**: the
  multi-path update now expands to per-field `id/field` paths. The old code
  passed `id → {patch}` paths, and RTDB `update()` REPLACES per path — any
  reorder/mark-all-read would have destroyed every sibling field of every
  record. Callers: master-data reorder (new), observation-categories reorder
  (latent, now safe), notifications mark-all-read (latent, now safe).

## 6. Permission Manager scrolling fix

The user list is now ONE bounded container: `arm-scroll max-h-[58vh]
overscroll-contain` (max-height + overflow-y on the same element — the
design-system thin Qnalys tokens), replacing the Radix ScrollArea whose
percentage-height viewport cannot resolve against a max-height parent.
Verified live: 20 users, viewport 520px over 1633px content, `overflow-y:
auto`, scrolled to the end — last user (System Owner) fully visible; search
filter reduces to 4 rows and the container shrinks naturally (no blank area);
search/filters stay above the list. Architecture untouched.

## 7. Browser history compatibility

Untouched and re-verified: section shifts push real sub-destination entries
(qnalys-history `isSettingsSectionShift`); Back/Forward traverse sections
inside Settings; global navigation to another page and Back restores the
section; reload adoption restores the section (store `applyHistoryEntry`
settings-scoped navParams). Mobile drawer selection follows the same path —
Back/Forward verified from the drawer-selected state.

## 8. Cache / page-state compatibility

No `queryClient.clear()`, no staleTime/gcTime changes, no new cache layer. The
new `['masterData', domain]` family follows the existing conventions (60s
staleTime, invalidation on every mutation). The master-data API uses the
existing db helpers whose write-invalidated TTL cache applies.

## 9. AR/EN + RTL/LTR

All new UI is Arabic-first via `<T>`/`translateUIText` with 18 new en-map
entries (§MASTER-DATA-SIMPLE block). DB labels carry name/nameEn — EN renders
`nameEn`. Verified live: EN (no Arabic leaks in the new surfaces), AR
(البيانات المرجعية domain list, Arabic table headers/badges/dialogs), RTL
(trigger row mirrored, drawer slides from the right, tables RTL) and LTR.
Stored business data is never auto-translated; labels only.

## 10. TypeScript

`npx tsc --noEmit` — 0 errors (run after every implementation phase).

## 11. ESLint

All touched files clean (config, types, master-data lib+routes, hooks,
SettingsPage/SectionNav/workspaces, consumers, PermissionManagerConsole, db.ts,
tests).

## 12. Focused tests

- NEW `src/lib/master-data/__tests__/simple-lists.test.ts` (20): bootstrap
  seeds (byte-identical keys/labels vs the type union and the page
  vocabulary), migration backfill (never renames/overwrites/deactivates),
  idempotency (converged run = zero writes), 401/403/200 matrix, manager
  create 201, unknown domain 404, key/name validation, duplicate prevention,
  deactivate/reactivate + config-audit actions with before/after,
  inactive-value guard + legacy acceptance, reorder assign/verify + partial
  rejection, referential delete guard with usage count, usage counts,
  presentation helpers.
- NEW `src/lib/__tests__/settings-sidebar-cleanup.test.ts`: the four pages
  overlayOnly + absent from the sidebar universe; real pages remain;
  masterData identity + preset matrix; SettingsPage gates by `canViewPage`;
  Permission Manager scroll container contract; consumer wiring pins.
- UPDATED `settings-sections.test.ts` (compact-nav contract: selections route
  through selectSection, nav never navigates globally, permission-based
  gating, drawer closes on selection, planned=2 audited reservations,
  available≥4) and `permission-visibility.test.ts` (monthClose/kpiSettings now
  Settings-internal: absent from sidebar visibility, grants unchanged).

## 13. Full test suite

2864 tests — **2861 pass / 3 fail**, all three pre-existing at HEAD and
documented by the previous delivery: `download-opt` notification-stats
contract (environment-dependent 0≠1), `find-user-by-email` (flaky,
environment), `global-search` #24 (static assertion on unmodified
EmployeesPage.tsx).

## 14. Build

`next build` succeeds (isolated `BUILD_DIST_DIR`); route manifest contains
`/api/master-data/[domain]` and `/api/master-data/[domain]/[id]`.

## 15. Manual verification (real browser, real DB; temp System Owner created
for the session and DELETED afterwards)

A. Sidebar: the four config sections absent (EN+AR, expanded rail, scrolled);
   real pages + Settings remain. B. Settings: ONE compact trigger row;
   content reclaims the space. C. Section switching stays inside Settings
   (General → Master Data → …; URL unchanged); sections panel lists all
   granted sections. D. Mobile (390×844): drawer opens, section select closes
   it and switches the section, Back/Forward traverse sections. E. Master
   Data: observation categories workspace intact (183-usage rows render);
   Follow-up Types seeded with REAL usage counts (Productivity 428) and
   create flow verified end-to-end ("Record added", row rendered).
   Deactivate/reactivate/reorder/delete verified against the live server API
   (isActive flips, guard message with the 113-usage count, duplicate key/name
   400s, reorder reversed+restored with ALL fields intact). F. Permission
   Manager: list scrolls internally to the last user. G. Search "ahmed" → 4
   rows, container shrinks naturally. H/I. EN/AR labels, RTL/LTR, dark/light
   all verified visually and via computed styles.

**Live-verification catch (fixed + repaired + re-verified)**: the reorder
test exposed the `updateRecords` RTDB replace-vs-patch bug (§5). The damaged
`followUpTypes` rows were repaired from the configAuditLog create snapshots +
ensure re-seed; the table now holds exactly the 10 canonical records
(byte-exact labels, order 1..10, all active); `observationCategories` (19
rows) and `complaintTypes`/`requestTypes` (seed-on-first-access) verified
intact. Reorder re-run live after the fix: fields survive.

## 16. Remaining genuine issues

1. The three pre-existing test failures above (untouched, documented).
2. dealStatuses / travelServiceTypes remain reserved until their engine
   wiring lands (by design — see §3/§4).
3. Historical risk note: any `updateRecords` call executed before this fix
   (category reorder / mark-all-read on notifications) would have truncated
   those records. `observationCategories` and the audited tables were checked
   and are intact; a notification-table audit is recommended as separate
   hygiene (out of scope here).
4. The Control Panel page chrome (tabs) still shows Arabic labels in the EN
   locale — pre-existing, untouched.
