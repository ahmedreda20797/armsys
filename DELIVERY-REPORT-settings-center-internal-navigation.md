# QNALYS — SETTINGS CENTER INTERNAL NAVIGATION & SECTION READINESS — DELIVERY REPORT

Task: Settings sections must behave as internal sections of ONE Settings workspace
(never global page jumps), with a canonical readiness state for unfinished sections,
Browser Back/Forward between sections, and unchanged Master Data / permissions /
global navigation.

---

## 1. Root Cause

`SettingsPage.tsx` modeled the Settings Center as **two embedded sections plus eight
outbound links**. The `LINKED_SECTIONS` list (controlPanel, organization, kpiSettings,
rulesEngine, rules, monthClose, qualityAuditLog, workflowDesigner) rendered rows whose
click handler called the store's global `navigateTo(id)`. That swaps `currentPage`,
unmounts the whole Settings workspace and mounts the target as an independent global
page — exactly the reported bug ("clicking a Settings section exits Settings").

The readiness gap was the corollary: because the only in-center content renderer was
the embedded pair, any section that was not a registered page had no in-center slot,
and the Master Data registry's five `planned` domains (Travel Service Types, Deal
Statuses, Follow-up Types, Complaint Types, Request Types) showed a generic
reservation note instead of the standard under-preparation state.

## 2. Settings Navigation (files & model)

| File | Change |
|---|---|
| `src/components/pages/SettingsPage.tsx` | **Reworked.** ONE unified internal section model: `EMBEDDED_SECTIONS` (general, masterData) + `PAGE_SECTIONS` (the 8 canonical config pages, whose **existing page components now render inside the Settings content area** via `next/dynamic` — zero duplication, same permission keys/APIs/chunks). Section rows are unified (same active styling, no outbound chevrons), compact chip row on small screens, labeled list on lg+. |
| `src/lib/settings/sections.ts` | **New.** Pure `sanitizeSettingsSection` fail-safe resolver (unit-testable). |
| `src/components/pages/settings/SectionUnderPreparation.tsx` | **New.** The one canonical under-preparation slot (§8 copy, AR/EN). |
| `src/components/pages/settings/MasterDataSection.tsx` | Planned domains now render the shared `SectionUnderPreparation` slot + keep the registry context line. Nothing else touched. |
| `src/lib/i18n/en-map.ts` | EN mappings for the §8 copy; chip `قيد التهيئة` → "Under preparation". |

**Section state model** — one canonical source:

```
Settings ('settings' route)
    store.navParams.section          ← the ONLY section state
        ↓ sanitizeSettingsSection (fail-safe → 'general')
    section renderer (content area swap; the shell never unmounts)
```

- Section click on the `settings` route: `navigateTo('settings', { section: id })` —
  a **same-page** update; `currentPage` never changes, so no global navigation and no
  remount can occur. Identical re-selection is a no-op.
- Unknown/permission-lost section values fail safe to `general` (§16).
- Legacy compat route (`observationCategories` deep-link): embedded sections switch in
  place; page-backed sections enter the canonical center only when the user holds the
  `settings` grant, else keep the historical direct-page navigation (PageRouter still
  gates every target).

## 3. Section Readiness (audited from code, not labels)

| Section | Verdict | Evidence |
|---|---|---|
| general | READY | language + theme preferences (embedded, works). |
| masterData | READY (section framework) | registry UI + full observation-categories CRUD workspace over `/api/observation-categories`; per-domain readiness below. |
| — observationCategories | READY | DB-driven, bilingual, active/order/CRUD/permissions/audit/cache-invalidation verified. |
| — travelServiceTypes / dealStatuses / followUpTypes / complaintTypes / requestTypes | UNDER PREPARATION | registry `status: 'planned'` — canonical §8 placeholder, chips, never fake screens. |
| controlPanel | READY | 4 tabs; `/api/dashboard/users`, `/api/activity-logs[/online]`. |
| organization | READY | tree/positions/users; `/api/organization[/move…]`, `/api/positions`. |
| kpiSettings | READY | 5 config sections; `/api/kpi-settings`, `/api/kpi-schemes`, `/api/rules/stats`. |
| rulesEngine | READY | rules CRUD + test/execute/logs; `/api/rules[/execute|stats]`. |
| rules | READY | deduction rules CRUD + sync; `/api/deduction-rules[/id|seed]`. |
| monthClose | READY | snapshots close/reopen with reason; `/api/month-snapshots/…`. |
| qualityAuditLog | READY | read-only audit viewer (registry `availableActions: []` by design); `/api/quality-audit-log`. |
| workflowDesigner | READY (standalone tool) | full authoring platform; persists via its local serializer by design (no backend). Rendered in a height-constrained host inside Settings; its own layout untouched. |

No top-level section is unfinished; the under-preparation mechanism is exercised by the
five planned Master Data domains and is available per-section via `SECTION_READINESS`.

## 4. Existing Functionality

Master Data & System Lists is unchanged and verified live: the observation-categories
workspace (search / add / edit / deactivate / reorder / safe-delete, bilingual fields,
DB-driven lists) renders inside the Settings workspace over its existing API and query
hooks. The registry, category IDs, stable keys, validation, audit and cache
invalidation are untouched (guarded by `settings-consolidation.test.ts`, which still
passes).

## 5. Browser History

Integrated through the ONE canonical history controller — no second system:

- `qnalys-history.ts`: a `section` param shift on the settings page is a **real
  sub-destination** → `pushState` (capture outgoing entry state + scroll-to-top);
  every other same-page param shift remains an in-place replace (filter doctrine
  unchanged).
- `store.applyHistoryEntry`: popstate / reload adoption restores `navParams` **only for
  the settings page** (section = entry identity); other pages' transient navParams stay
  non-restored exactly as before.
- Verified live (real browser, real history):
  - Settings/عام → Settings/مركز التحكم → **Back** = Settings/عام (still inside Settings);
    **Forward** = Settings/مركز التحكم. (Test C)
  - Settings/مركز التحكم → Employees (leaves Settings) → **Back** = Settings/مركز
    التحكم with the section restored. (Test D)
  - Reload adopts the current entry → the section is restored after refresh (§14;
    no settings data in the URL — state rides the history entry + page-state layers).

## 6. Permissions

Nothing weakened. Section visibility keeps the existing `visiblePages` filter; the
sanitizer refuses sections the user cannot access; section/action authorization stays
server-authoritative (`settings:masterData`, `observationCategories` behavior
unchanged); the legacy-route fallback is guarded by `canViewPage('settings')`.

## 7. Localization

- AR source + EN_MAP entries; §8 copy verified rendered in both locales.
- RTL: right-side settings navigation with start-aligned rows, logical properties
  only (`text-start`, flex axis flip at `lg`); LTR verified (layout flips, no Arabic
  leak; `hasArabic`-checked live: AR placeholder absent in EN and vice versa).

## 8. Verification

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | ✅ 0 errors |
| ESLint (all touched files) | ✅ 0 problems |
| Focused tests (history, bridge, settings-sections, consolidation) | ✅ 75/75 |
| Full suite | ✅ 2779 pass / **3 pre-existing failures** (see §9) |
| Build (`next build`) | ✅ compiled + 97/97 static pages (run with `BUILD_DIST_DIR` isolation because the running dev server locks `.next\standalone` on Windows) |
| Live browser verification | Temp admin (created for the session, **deleted afterwards** — users back to 18): internal switching, Back/Forward, under-preparation AR/EN, Master Data workspace, RTL/LTR all verified via screenshots. |

## 9. Remaining Issues (all pre-existing, verified against pristine HEAD)

1. `download-opt-route-contracts.test.mts` — "stats contract … one successful rule log
   today" (0 ≠ 1): environment/DB-dependent; fails identically on a clean checkout of HEAD.
2. `find-user-by-email.test.mts` — flaky environment failure; fails on pristine HEAD, passed
   in later runs of this session.
3. `global-search.test.ts` #24 — static assertion expects `useRecordHighlight(` in
   `EmployeesPage.tsx`; that file is unmodified by this task and fails in isolation —
   pre-existing contract drift, not touched here.

None of these relate to the Settings navigation change.
