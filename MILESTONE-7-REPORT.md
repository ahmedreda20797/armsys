# Milestone 7 — Implementation Report

## Overview

Milestone 7 delivers two independent, tightly-scoped deliverables:

| ID | Deliverable | Surface | Purpose |
|----|------------|---------|---------|
| **7A** | HR PerformanceFactor Groundwork | `src/lib/hr-performance/` + `GET /api/hr-performance/[month]/[employeeId]` | Independent, time-scoped HR factor over stored `hrDeductions` — metric groundwork, **no invented score** |
| **7B** | Quality Observation Evidence Viewer | `ObservationsPage.tsx` detail dialog + `src/lib/quality-observations/evidence.ts` | Dedicated «الدليل / الإثبات» section: display, copy, view, safe open-link |

Both follow the established architecture. No unified engine, no final KPI, no weights, no cross-domain composition was introduced.

---

## §1  Files Created / Modified

### New files

| File | Purpose |
|------|---------|
| `src/lib/hr-performance/index.ts` | HR PerformanceFactor service — pure builders + loader-injected orchestrator |
| `src/lib/hr-performance/__tests__/hr-performance.test.ts` | 20 tests — aggregation, isolation, no-data, time scope, domain separation, pending-score contract |
| `src/app/api/hr-performance/[month]/[employeeId]/route.ts` | Read-only API: auth → permission → validate month/employeeId → stored HR data |
| `src/lib/quality-observations/evidence.ts` | Pure evidence classification: safe URL parsing, empty/text/url kinds, display truncation |
| `src/lib/quality-observations/__tests__/evidence.test.ts` | 32 tests — URL detection, plain text, empty state, security schemes, copy exactness, UI regression |
| `scripts/milestone-7-runtime-verification.ts` | Read-only production verification (HR no-data path + evidence classifier over real observations) |

### Modified files (1)

| File | Change |
|------|--------|
| `src/components/pages/quality-kpi/ObservationsPage.tsx` | Added the Evidence section (`ObservationEvidenceSection`) + full-view dialog (`EvidencePreviewDialog`) **inside the existing detail dialog**; 3 icon imports + helper imports. Nothing else touched. |

### Files NOT modified (scope lock honored)

Canonical Attendance Engine, `attendanceResults` storage, Attendance KPI, Quality KPI formula, Quality snapshot architecture, approval architecture, `monthSnapshots`, `kpi-scoring` library, `time-scope` contract, `employee-performance` service (imported read-only), Quality Observation DB schema (no migration — the existing `evidence: string` field is reused as-is).

---

## §2  7A — HR PerformanceFactor Groundwork

### Source of truth

The **existing `hrDeductions` collection** — the same domain Milestone 5 exposed through `aggregateHrMonth` in the employee-performance service. The HR factor imports that established aggregation verbatim (`import { aggregateHrMonth } from '@/lib/employee-performance'`); no second aggregation logic, no duplicated weight system, no second scoring interface. HR deductions are **never** derived from Attendance, Quality, Sales, raw fingerprint, or Daily Attendance.

### Monthly / time-scope behavior

Every factor result carries:
- `month: "YYYY-MM"` — its own identity,
- `scope: { kind: 'selected_month', monthKey }` — from the shared TimeScope vocabulary (M4),
- `scopeLabel: "الموارد البشرية — 2026-08"` style Arabic label.

There is **no all-time current HR score**. A month with no records returns `hasData: false` with a zeroed summary — never another month's values, never a fabricated 100.

### Scoring status — PENDING BUSINESS CONFIGURATION

Inspected the HR domain before implementing: **no canonical HR score formula exists** in the current system (`hrDeductions` routes store raw deduction records; Employee 360 counts them; nothing scores them). Per spec §6, no formula was invented:

- `scoringStatus: 'pending_business_configuration'` is carried on every result.
- `performanceFactor.score = 0`, `maxScore = 1`, `normalized = 0` — a deliberate sentinel so no downstream consumer can misread the metrics as a finalized score. Tests explicitly verify this is **not** `100 − deductions` and that zero deductions do **not** produce 100.
- The raw monthly metrics are fully preserved in `summary` + `breakdown`: deduction days (Σ amount where unit = 'days'), deduction amount (Σ monetary units), deduction count, per-status counts.
- The missing scoring rule is documented here and in the module header.

### PerformanceFactor integration

Uses the **generic** `PerformanceFactor` type from `@/lib/kpi-scoring` (same interface Quality and Attendance expose):

```ts
{
  factorId: 'hr',
  factorName: 'الموارد البشرية',
  score: 0,          // pending sentinel — see above
  maxScore: 1,
  weight: 1,         // default-safe placeholder; the future engine owns weights
  normalized: 0,
  breakdown: { deductionCount, deductionDays, deductionAmount }
}
```

No `HRPerformanceFactor` interface was created — only a result wrapper (`HrPerformanceFactorResult`) carrying the generic factor, mirroring the M6 `AttendanceKpiResult` pattern.

### API

`GET /api/hr-performance/[month]/[employeeId]`

| Requirement | Implementation |
|---|---|
| Authenticate | `verifyPermission(request, 'reports', 'view')` — identical gate to `/api/attendance-kpi` reads |
| Permission architecture | Existing `verifyPermission` + `api-error` factories |
| Validate month | `validateMonthKey` (strict YYYY-MM, 01–12, 1900–2100) |
| Validate employeeId | non-empty check (established convention) |
| Read stored HR data | `getHrPerformanceFactor` → single cached `getAll('hrDeductions')` read, filtered in memory |
| No-data state | `hasData: false` + zeroed summary (200) — explicit, never an error, never fabricated |
| Writes / recalculation | **None** — route is strictly read-only |

### Domain separation

The module imports only: `@/lib/kpi-scoring` (type), `@/lib/time-scope` (type), `@/lib/month-utils`, `@/lib/employee-performance` (HR aggregation + table constant), `@/lib/db`. No Attendance, Quality, or Sales module is imported — verified by tests. Quality, Attendance, and HR remain independent factors; nothing is combined.

### Tests (20 — all passing)

Monthly aggregation (days/monetary/mixed), employee isolation (builder + loader level), month isolation, no-data state, time-scope metadata, domain separation (breakdown keys contain only HR metrics; factorId ≠ attendance/quality/sales), PerformanceFactor shape, pending-score contract (score not derived from deductions; zero deductions ≠ 100), orchestrator loader injection, invalid month/employeeId rejection.

---

## §3  7B — Quality Observation Evidence Viewer

### Evidence source field

The **existing** `evidence: string` field on `QualityObservation` — reused as-is. No `evidenceUrl`/`attachment`/`proofUrl`, no schema change, no migration. The section renders from the already-loaded `obs` object: **zero new fetches**, zero additional Firebase reads when opening the dialog (§23), no audit events for viewing (§22 — viewing is not a mutation).

### URL detection

`parseSafeHttpUrl` uses the **WHATWG `URL` parser** (never `startsWith('http')`):
- Parses strictly; whitespace trimmed first; hostname required.
- Protocol **allow-list**: `http:` and `https:` only.
- `javascript:`, `data:`, `file:`, `mailto:`, `vbscript:`, `ftp:`, `about:`, `chrome:` → classified as **plain text**, never linked.
- Bare domains / dotted text (`www.example.com`, `example.com/path`, `1.2.3.4`, `ملف.مرفق.pdf`) → **plain text** (no fragile dot heuristic).

### Plain-text handling

Rendered as React JSX text (auto-escaped). Preview wraps (`whitespace-pre-wrap break-words`) inside a scrollable container (`max-h-28 overflow-y-auto`) — no horizontal overflow, no truncation of the stored value. عرض الدليل shows the **complete** text in the preview dialog.

### Copy behavior — نسخ الدليل

`navigator.clipboard.writeText(evidence)` copies the **exact original stored value** — no trimming, no formatting changes. Success toast via the app-standard `sonner` (`toast.success('تم نسخ الدليل')`).

### View behavior — عرض الدليل

Opens an in-app full-view dialog: complete evidence value (never truncated, `select-text`), copy button, close button — plus فتح الرابط inside when the evidence is a URL.

### Open-link behavior — فتح الرابط (URL evidence only)

A real `<a href={url} target="_blank" rel="noopener noreferrer">` — semantic, middle-click friendly, and safe because the href is protocol-allow-listed through URL parsing. No unsafe `window.location` / DOM APIs on user-controlled input.

### Final UX choice (documented per spec §16.3)

Three clearly-labeled controls for URL evidence — **not duplicates**: نسخ (clipboard) / عرض (in-app full-view dialog) / فتح الرابط (direct external open). Text evidence shows نسخ + عرض only. Empty evidence shows only «لا يوجد دليل / إثبات» — **no buttons rendered**.

### Security handling

| Threat | Mitigation |
|---|---|
| HTML/script injection | React JSX text rendering only; `dangerouslySetInnerHTML` appears **nowhere** in the page (test-asserted); evidence never converted to HTML |
| `javascript:` links | Never classified as URL → rendered as inert text |
| `data:` URIs | Same — inert text |
| Reverse tabnabbing | `rel="noopener noreferrer"` on every external link |
| Unvalidated DOM APIs | None — links are parsed, allow-listed `<a>` elements |

### Responsive behavior

URL display uses `break-all` + `dir="ltr"` inside `min-w-0` containers; text uses `break-words`; action row is `flex flex-wrap`. Long URLs wrap/truncate **visually** only — the dialog never widens and no page-level horizontal scroll can occur. The full original URL remains available through Copy / View / Open. Verified against the existing dark-theme RTL dialog conventions (`dir="rtl"`, slate palette, cyan accent to distinguish from notes/approval/timeline).

### Tests (32 — all passing)

URL detection (https, http, Drive, Docs, ports/query/fragment, 2000-char URL, surrounding whitespace), plain text (Arabic, complaint numbers, dotted text never a URL, multiline, verbatim preservation), empty state (empty/whitespace/null/undefined + label), security (javascript:, data:, file:, mailto, vbscript:, ftp:, about:, chrome:, scheme-confusion tricks, non-strings), copy exactness (display truncation never mutates the original), UI regression via source introspection (evidence section present; all three Arabic action labels; empty label; approval history/timeline/approve/reject intact; admin edit/delete + month lock intact; no `dangerouslySetInnerHTML`; no evidence fetch layer; noopener+noreferrer present).

---

## §4  Verification

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | **New/modified files: 0 errors.** Remaining errors are pre-existing baseline in untouched files (`EmployeeQualityKpiPanel.tsx`, `kpi-dashboard`/`riskMetrics` tests, `quality-migration`, `workflow/`) |
| `npm run lint` | **Identical to clean-HEAD baseline** (11,854 problems / 559 errors before and after — verified via `git stash` comparison). Zero new issues introduced |
| `npm test` | **609/610 pass.** The 1 failure (`quality-migration` test: `JWT_SECRET environment variable is required`) fails identically on clean HEAD — pre-existing baseline, unrelated |
| `npx tsx --test src/lib/hr-performance/__tests__/*.test.ts` | **20/20 pass** |
| `npx tsx --test src/lib/quality-observations/__tests__/*.test.ts` | **35/35 pass** (32 new evidence + 3 existing admin-override) |

No unrelated modules were modified to make any gate green.

## §5  Runtime Verification (read-only, real production database)

`npx tsx --env-file=.env scripts/milestone-7-runtime-verification.ts` — **5/5 checks passed**:

**HR**: production `hrDeductions` contains **0 records** → the explicit no-data state was verified end-to-end (`hasData=false`, zeroed summary, scoring stays pending, score never fabricated as 100). Per spec, no HR data was fabricated.

**Evidence**: production `qualityObservations` contains **28 records**, classified with the production classifier: **27 URL** (real Bitrix24 CRM links, all parse as safe http(s)), **0 text**, **1 empty**. Every classified URL re-parsed successfully. No production records were created or modified. Interactive copy/view/open verification is available against these 27 real URL observations + the 1 empty observation via تفاصيل in the Observations page; no text-evidence record exists in production today (covered by the 32 unit tests instead).

## §6  Known baseline issues (unchanged by this milestone)

1. `tsc`: ~20 pre-existing errors in `EmployeeQualityKpiPanel.tsx`, `kpi-dashboard`/`riskMetrics` tests, `quality-migration/index.ts`, `workflow/` modules.
2. `lint`: 559 pre-existing errors / 11,295 warnings (project-wide).
3. `npm test`: `quality-migration` test requires `JWT_SECRET` in the environment.

## §7  Remaining limitations

- **HR scoring rule undefined** — deliberate, documented pending state. The factor exposes verified raw monthly metrics only; the future milestone that receives the business formula can populate `score`/`maxScore` without touching storage or the API shape.
- **HR runtime data absent** — the production `hrDeductions` collection is empty, so only the no-data path was runtime-verifiable.
- **No text-evidence production record** exists for manual UI walkthrough (unit-tested instead).
- HR factor batch endpoint (all employees for a month) was not requested; the single employee-month surface matches spec §8.

## §8  Recommendation for the next milestone

1. **Business decision needed**: define the canonical HR score formula (e.g. how deduction days/amounts map to points, floors, caps) — then populate `performanceFactor.score` behind the existing `scoringStatus` flag, with kpi-scoring's `computeScoreFromAdjustments` as the only calculator.
2. Seed or import real HR deduction data so the HR factor has runtime-verifiable substance.
3. After HR scoring lands, the natural next groundwork step is the **Sales factor** (the last missing independent factor before any composition discussion).

---

**Scope lock respected** — no Unified Performance Engine, no final KPI, no Quality × 15%, no Sales KPI, no Attendance Close/Reopen, no Daily/Weekly-Off redesign, no fingerprint work, no Admin Control Layer, no User Workspace, no dashboard/360 redesigns. Stopped for review.

ATTENDANCE MILESTONE 7 — COMPLETE
