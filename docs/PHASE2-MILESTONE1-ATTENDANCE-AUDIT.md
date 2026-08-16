# ARM ERP — Phase 2: Enterprise Attendance & Policy Engine
## Milestone 1 — Attendance Architecture, Data Flow & Rule Audit (READ-ONLY)

**Date:** 2026-08-16
**Scope:** Audit / discovery only. No production code, Firebase data, or configuration was modified. No test data was created.

---

## §1 Current Attendance Architecture

The system has **two attendance-facing features plus one monthly calculation engine**, backed by a generic Firebase RTDB data layer.

### 1.1 Monthly Fingerprint — "البصمة"

| Layer | File | Responsibility |
|---|---|---|
| Page | `src/components/pages/BiometricPage.tsx` | Raw fingerprint viewer: upload Excel, filter by month/employee, search, group by month, "clear month" dialog. **No calculation logic.** |
| Import API | `src/app/api/biometric/upload/route.ts` | Excel (XLSX) parse → `biometrics` records. Arabic/English column mapping, Excel-serial date/time parsing, employee matching + auto-creation. |
| Read API | `src/app/api/biometric/route.ts` | `getAll('biometrics')` → join employee name → return **entire collection** (no server-side month param). |
| Delete API | `src/app/api/biometric/clear/route.ts` | Delete all `biometrics` whose `date` contains `/MM/YYYY` substring. |
| Collection | `arm_erp/biometrics` (RTDB) | Raw imported rows (see §2). |
| Permissions | `src/config/permissions.ts:55` | Resource `biometric`: create/update/delete/**upload**. Note: the HR role preset does **not** include `upload` (line 107) — only admin does. |

**Parsing / normalization details** (`upload/route.ts`):
- Header row auto-detected (first row with ≥2 non-empty cells, line 73-77); columns mapped via `COLUMN_MAP` (الاسم/name, الكود/code, التاريخ/date, الحضور/checkIn, الانصراف/checkOut; lines 6-12).
- Dates: Excel serial numbers (30000–100000) converted with epoch 1899-12-30 to **`DD/MM/YYYY` padded strings** (lines 33-42). Non-numeric strings passed through **unvalidated**; `ـــ`/`---`/`-` → null.
- Times: Excel day-fractions → `HH:MM` (lines 19-31). Text times stored **raw** (e.g. `9:07` or `09:17:05`) — no canonical time normalization.
- Month key `YYYY-MM` extracted per row and stored in a `month` field (lines 44-51, 126-133) — **this field is never read anywhere** (verified by grep across `src/`); all month filtering re-parses the `date` string.
- **No duplicate detection / idempotency**: re-uploading the same file duplicates every record. The only remedy is the "clear month" endpoint.
- **Employee matching** (lines 110-124): `allEmployees.find(e => (code && e.code === code) || e.name === name)` — first match wins; fallback `findFirst('employees', { name })`; **if still unmatched, a new employee record is auto-created** from the spreadsheet row.

### 1.2 Daily Attendance — "الحضور والانصراف"

| Layer | File | Responsibility |
|---|---|---|
| Page | `src/components/pages/AttendancePage.tsx` | Manual record entry (add check-in, checkout dialog, edit dialog, delete), Excel upload button, summary cards, month filter. **Client-side lateness policy** (see §4). |
| APIs | `src/app/api/attendance/route.ts` (GET list w/ search/month/status params, POST create); `src/app/api/attendance/[id]/route.ts` (PUT, DELETE) | Thin CRUD over `attendance` collection. |
| Collection | `arm_erp/attendance` | Operational daily records (see §2). |
| Permissions | `src/config/permissions.ts:54` | Resource `attendance`: create/update/delete/export. |

**Verified facts:**
- Statuses: `present | late | absent | approved` (`src/types/index.ts:42`).
- `minutesLate` is computed **in the browser** (`AttendancePage.tsx:80-94`) against `employee.shiftStart`, then trusted by the API verbatim (`attendance/route.ts:54-74` stores it as-is).
- `PUT /api/attendance/[id]` merges the client body **without field whitelist or re-computation** (`[id]/route.ts:18`) — editing check-in does not recompute `minutesLate` server-side.
- The Excel upload button posts to `/api/attendance/upload` (`AttendancePage.tsx:169`) — **that endpoint does not exist** (only `route.ts` and `[id]/route.ts` are present). Clicking it produces a 404.
- There is **no weekly-off concept** and **no fingerprint-vs-daily comparison** anywhere in the daily attendance feature. The daily page never reads `biometrics`.
- Dead code: `else if (!checkIn)` inside the `if (checkIn && shiftStart)` branch can never execute (`AttendancePage.tsx:207-208`).

### 1.3 Requests (workflow that feeds the monthly engine)

- Page `src/components/pages/RequestsPage.tsx`; APIs `src/app/api/requests/route.ts`, `[id]/route.ts`.
- Types: `leave` (إجازة), `permission` (استئذان), `excuse` (غياب), `tardiness` (تأخير), `remote` (`src/lib/date-utils.ts:33-42`).
- Approval: PATCH with `{status: 'approved'|'rejected', reviewedBy}` — requires `requests: approve` (admin, HR, manager).
- **Side effect on attendance** (`requests/[id]/route.ts:46-62`): approving/rejecting an **`excuse`** request auto-creates an `attendance` record with `status: 'absent'`, `approvedRequestId: <request id>`, and notes describing "1 day" (approved) or "2 days" (rejected) deduction. This is the only writer of `approvedRequestId`.
- Deleting a request does **not** remove or update the linked attendance record (no cleanup in DELETE, lines 78-96) → orphan `approvedRequestId` references.
- The requests Excel-upload button targets `/api/requests/upload` (`RequestsPage.tsx:146`) — **also a missing endpoint (404)**. (Existing upload endpoints: biometric, employees, quality, travel only.)

### 1.4 Monthly Calculation & Policy — the de-facto "engine"

| Route | File | Role |
|---|---|---|
| `POST /api/reports/generate` | `src/app/api/reports/generate/route.ts` (510 lines) | Full-company monthly calculation: per employee × per calendar day precedence ladder → present/late/absent/exempt + deduction days + compliance %. |
| `POST /api/reports/employee-detail` | `src/app/api/reports/employee-detail/route.ts` (589 lines) | Same engine duplicated for one employee, with per-day `dailyBreakdown`. **Diverges from `generate` in two places** (§6, §7). |
| `POST /api/reports/export` | `src/app/api/reports/export/route.ts` | ExcelJS export — renders **client-supplied rows** (`{month, data, meta, summary}` from the browser), not a fresh server calculation. |
| `POST/DELETE /api/reports/waive-deduction` | `src/app/api/reports/waive-deduction/route.ts` | Manual deduction waivers persisted in `waivedDeductions`. |
| Page | `src/components/pages/ReportsPage.tsx` | Month picker (`YYYY-MM`), generate button, inline employee-detail rows, waive/restore buttons, export. Results cached in `sessionStorage` key `erp_report_data` only. |

**The monthly result is ephemeral** — nothing is persisted server-side except waivers. Every view regenerates from raw inputs.

### 1.5 Policy engine location — answer to §7 of the brief

The attendance policy is **not centralized**. It is implemented in **four places** with copy-paste duplication and verified divergence:

1. `src/app/api/reports/generate/route.ts` (server, full company)
2. `src/app/api/reports/employee-detail/route.ts` (server, per-employee — near-clone of #1)
3. `src/components/pages/AttendancePage.tsx` (client — grace period + lateness for manual entry)
4. `src/config/permissions.ts` / ReportsPage display thresholds (UI bands only)

`src/lib/rules-engine.ts` (AutomationRule engine) is a **notification/automation** engine (create notification / follow-up / CAPA). Attendance policy does **not** flow through it. The `deductionRules` RTDB table is a config store whose values are **force-overwritten to hardcoded canonical values on every report run** (`syncRulesToCanonical`, both report routes lines 16-29) — editing deduction amounts via `/api/deduction-rules` is effectively cosmetic.

### 1.6 Other consumers (read-only integrations)

- **Employee 360** — `src/app/api/employee-360/[id]/route.ts:97-101`: computes current-month present/late/absent/exempt from the **`attendance` collection only** (ignores biometrics and the report engine).
- **Home stats** — `src/app/api/home/stats/route.ts`: "today" snapshot and `computeMonthlyPerformance` (lines 106-166) also read **`attendance` only**.
- **AOCC** — `src/lib/aocc/event-collector.ts:619`: department `attendanceRate = (present + late*0.5)/total*100` (a third, different formula) based on home-stats data.
- **Risk engine** — `src/lib/metrics/riskMetrics.ts:171-172`: `delayCount` / `absenceCount` feed weighted risk (attendance counts come from the `attendance` collection).
- **Salary**: **no salary module exists**. Deduction results leave the system only via the Excel export (days + EGP). No `salary` code (grep verified; only CAPA/AOCC text mentions).

### 1.7 Employee identity (brief §10)

- Canonical identity: `employees.id` (cuid2, generated in `createRecord`, `src/lib/db.ts:134-141`). All collections reference `employeeId`.
- Fingerprint matching: **code exact-match, else name exact-match, first hit wins** (`biometric/upload/route.ts:112`). Duplicate names → silent misattribution to whichever employee `find()` returns first.
- Unmatched rows **auto-create employees** (lines 116-124) — the employees table is polluted by spreadsheet names.
- No active/inactive lifecycle: the `Employee` type has no status field; `validateEmployeeId` checks an undeclared `isSuspended` field that nothing writes (dead check, `src/lib/validate-employee.ts:50-55, 64`) — every employee always passes as "active". No transfer/handling of inactive employees exists.

### 1.8 Month-boundary rules (brief §11)

- **Storage format**: all dates are `DD/MM/YYYY` **strings**; months are `YYYY-MM`. No ISO dates at boundaries.
- **Month membership**: substring containment `date.includes('/MM/YYYY')` (generate route line 94, clear route line 21). Works for padded dates produced by the importer, but **unpadded manual dates (e.g. `5/8/2026`) silently fall outside** every month filter and the report calculation. POST/PATCH never validate format.
- **Current-month cutoff**: report loops stop at "today" using **server-local** `new Date()` (generate lines 81-89). The daily page prefills "today" using **client-local** time (`AttendancePage.tsx:72-78`), and home-stats uses server-local again (`home/stats/route.ts:10-13`). If client and server timezones differ, records created "today" can land on a different server date near midnight.
- **Working days = ALL calendar days**, weekends included (`getWorkingDaysInMonth`, both report routes). `dayIndex` is computed but never used for exclusion; the code comment "weekends shown but not penalized" (generate line 430) **does not match behavior** — a record-less Friday/Saturday goes through Priority 7 and becomes an absence day, offset only by the 4-free-day allowance. Whether the company genuinely works 7 days is a business question to confirm; mechanically, weekends are not excluded.
- **No overnight/late-night shift handling**: `checkIn`/`checkOut` are same-day strings; there is no cross-midnight pairing logic.
- **Broken sort**: `sortByDateField(records, 'date')` (`attendance/route.ts:36`) parses `DD/MM/YYYY` via `new Date()` → Invalid Date → NaN comparator; the sort is a no-op (the client re-sorts, masking it).
- Last-day-of-month / first-of-next-month: nothing special — the substring `/MM/YYYY` cleanly partitions months for padded dates; no cross-month record splitting exists (a fingerprint on 31/08 stays in August).

---

## §2 Current Data Model

All data lives in Firebase **Realtime Database** under `arm_erp/<table>` via the generic layer `src/lib/db.ts` (full-table `get()`, in-memory cache with TTL tiers: attendance 5s, biometrics 30s, deductionRules 60s; lines 20-25).

| Collection | Purpose | Key fields | Classification | Writes | Reads |
|---|---|---|---|---|---|
| `employees` | Canonical workforce registry | `code` (nullable string), `name`, `department`, `position`, `shiftStart`, `shiftEnd`, `hireDate`, `mobile` | MASTER | EmployeesPage CRUD; **biometric upload auto-creates** | Everything (joins) |
| `biometrics` | RAW fingerprint import rows | `employeeId`, `date` DD/MM/YYYY, `checkIn`, `checkOut`, `month` (dead), `createdAt` | **RAW** | biometric upload; clear-month deletes | reports/generate, employee-detail, BiometricPage, home stats (count only), Employee360 (fetched, unused in stats) |
| `attendance` | OPERATIONAL daily records (manual HR entry + excuse-approval side effects) | `employeeId`, `date`, `status`, `checkIn`, `checkOut`, `minutesLate` (client-computed), `notes`, `approvedRequestId` | **OPERATIONAL** (mutable) | AttendancePage CRUD; requests approval (excuse) | report engine (fallback source), Employee360, home stats, AOCC, risk engine |
| `requests` | Leave/permission/excuse/tardiness/remote workflow | `employeeId`, `type`, `date`, `reason`, `status`, `reviewedBy/At` | WORKFLOW INPUT | RequestsPage CRUD + approvals | report engine (precedence), Employee360, home stats |
| `deductionRules` | Policy amounts | `key` (`late15`/`late30`/`late60`/`absence`/`singleFingerprint`), `label`, `amount`, `unit` days\|EGP | POLICY CONFIG (effectively read-only — force-synced) | deduction-rules API (cosmetic); **syncRulesToCanonical on every report run** | report engine; home stats summary |
| `waivedDeductions` | Manual per-day deduction waivers | `employeeId`, `date`, `month`, `deductionType` late\|absence\|all, `reason` | POLICY OVERRIDE | waive-deduction API | report engine |
| `qualityDeductions` | Quality-engine deductions (Phase 1 domain) | `employeeId`, `month`, `deductionDays`, `deductionAmount` | EXTERNAL POLICY OUTPUT | Quality module | report engine (totals) |
| `hrDeductions` | Manually raised HR deductions w/ approval | `employeeId`, `type`, `amount`, `unit` days\|EGP, `month`, `status` pending\|approved\|rejected, `relatedCapaId` | EXTERNAL POLICY OUTPUT | hr-deductions API + CAPA link | report engine (approved only), Employee360 |

**Derived / policy-output layer is NOT persisted.** The Monthly Attendance Result (present/late/absent counts, deduction days, compliance) exists only inside HTTP responses and per-tab `sessionStorage`. Conceptual classification found in reality:

```
RAW            biometrics (fingerprint import)
WORKFLOW INPUT requests
OPERATIONAL    attendance (manual + excuse side-effect)
POLICY CONFIG  deductionRules (hardcode-synced), waivedDeductions
EXTERNAL       qualityDeductions, hrDeductions
DERIVED        (ephemeral) reports/generate + employee-detail responses
```

There is **no** persisted monthly-result or violation collection. Salary/reports backward compatibility today depends solely on regenerating from raw inputs + the Excel export.

---

## §3 Current Data Flow (with exact functions)

### 3.1 Monthly fingerprint flow

```
Excel file (.xlsx)
  └─ BiometricPage.handleUpload (BiometricPage.tsx:119)
      └─ POST /api/biometric/upload
          └─ XLSX.read → sheet_to_json (upload/route.ts:66-68)
          └─ normalizeHeader + COLUMN_MAP (6-17)
          └─ parseExcelDate / parseExcelTime (19-42)
          └─ extractMonth → YYYY-MM (44-51)
          └─ Employee match: code→name→auto-create (110-124)
          └─ createRecord('biometrics', {...}) per row (127-133)
  └─ POST /api/reports/generate {month}   (ReportsPage)
      └─ getWorkingDaysInMonth — ALL calendar days (generate:40-51)
      └─ current-month cutoff to today (81-89)
      └─ syncRulesToCanonical() — WRITES deductionRules (16-29, 97)
      └─ 8 parallel full-table loads (100-109)
      └─ per-employee × per-day precedence ladder (209-393):
            P1  att.approvedRequestId (excuse): approved=1d / rejected=2d / pending=1d
            P1b att.status==='approved' → exempt
            P2  request.status==='approved' → exempt (overrides everything)
            P3  biometric checkIn → lateness vs shiftStart;
                missing checkOut → +0.5d (singleFingerprint)
            P4  biometric checkOut only → present + 0.5d
            P5  attendance record fallback (max(client minutesLate, recomputed))
            P6  request only: approved→exempt / rejected→2d / pending→1d+unaccounted
            P7  nothing → absence 1d (+unaccounted)
            (every step honors isWaived(emp,date,type))
      └─ post-process: sort absent days, first 4 free (399-413)
      └─ bonusDays = max(4 - totalAbsent, 0) (402)
      └─ merge quality + approved HR deductions (416-426)
      └─ compliance = (present+late+exempt+bonus)/allDaysToToday, cap 100 (432-436)
  └─ POST /api/reports/export {month, data(client rows), meta, summary}
      └─ ExcelJS rendering of client-held data (export/route.ts:13-14)
  └─ (manual corrections) POST/DELETE /api/reports/waive-deduction
      └─ waivedDeductions — the ONLY persisted correction layer
```

### 3.2 Daily attendance flow

```
HR user
  └─ AttendancePage.handleAdd (192-249)
      ├─ client: calcMinutesLate(checkIn, employee.shiftStart) + isLate(>15) (80-94)
      └─ POST /api/attendance {employeeId, date, checkIn, status, minutesLate}
          └─ validateEmployeeId (attendance/route.ts:61-65)
          └─ createRecord('attendance', ...) (67-74)
  └─ checkout dialog → PUT /api/attendance/[id] {checkOut}   (unvalidated merge)
  └─ edit dialog → PUT (status/times/notes; minutesLate NOT recomputed)
  └─ Excel upload button → POST /api/attendance/upload → 404 (endpoint missing)

Requests branch (feeds the same collection):
  excuse request approved/rejected (requests/[id]/route.ts:46-62)
      └─ auto-createRecord('attendance', {status:'absent', approvedRequestId, notes})
```

Separately (parallel operational views, **not** connected to the engine):
```
attendance collection → GET /api/attendance → page table
attendance collection → Employee360 stats (current month only)
attendance collection → home/stats today + monthly performance
attendance collection → AOCC dept attendanceRate ((present + late*0.5)/total)
```

---

## §4 Current Policy Rules — Verified Inventory (brief §8)

Every rule below is implemented and cited. **Rules NOT found anywhere (verified by search):** early-departure deduction, overtime, holiday calendar, weekly-off exclusion, consecutive-absence escalation, repeated-lateness escalation, warning levels, per-employee exceptions (beyond `shiftStart`).

| # | Rule | Current behavior | Source (file:line) | Input | Output |
|---|---|---|---|---|---|
| R1 | Late grace period | First 15 minutes free; "late" starts at minute 16. Hardcoded in **3 places** | `AttendancePage.tsx:80`; `generate:177`; `employee-detail:41` | checkIn, shiftStart | late flag |
| R2 | Lateness 16–30 min | Deduct 0.25 day | `generate:191-196` (`getLateRuleKey` → `late15`); canonical table `generate:8-14` | minutesLate | 0.25 day |
| R3 | Lateness 31–60 min | Deduct 0.5 day | same → `late30` | minutesLate | 0.5 day |
| R4 | Lateness ≥61 min | Deduct 1 day | same → `late60` | minutesLate | 1 day |
| R5 | Absence | 1 day per absent day (before allowance) | `generate:390` (`getDeductionDays('absence')`) | record-less day | 1 day |
| R6 | Single fingerprint | Check-in w/o check-out, or check-out w/o check-in → 0.5 day | `generate:282-296` (`singleFingerprint`) | biometric pair | 0.5 day |
| R7 | Free absence allowance | First 4 absent days (sorted by date) free; unused allowance → `bonusDays` counted as attendance | `generate:38-40, 399-413`; `employee-detail:40, 468-486`; UI renders `X/4` (`ReportsPage.tsx:861`) | absent-day list | 0 deduction + bonus |
| R8 | Excuse request (غيب) | Approved → 1 day deduction; rejected → **2 days**; pending → 1 day + unaccounted. Implemented **twice**: request approval writes an `attendance(absent, approvedRequestId)` note (`requests/[id]:46-62`), then report Priority-1 re-derives 1/2 days (`generate:237-251`) | see left | request status | deduction days |
| R9 | Excuse divergence | `employee-detail` treats `att.approvedRequestId` as **fully exempt** (0 deduction) — contradicts `generate` | `employee-detail:265-271` vs `generate:237-251` | same input | different output |
| R10 | Approved request | Any approved `requests` row exempts the day from ALL deductions, even with fingerprint present | `generate:260-265` | request | exempt day |
| R11 | Approved attendance | `attendance.status === 'approved'` → exempt | `generate:254-258` | attendance | exempt day |
| R12 | Manual waiver | Manager waives late/absence deduction for a specific date; respected by both engines | `waive-deduction/route.ts`; `generate:162-169` | waivedDeductions | 0 deduction |
| R13 | Source precedence | biometric checkIn > biometric checkOut-only > attendance > request > nothing (per-day ladder) | `generate:230-393` | day inputs | day status |
| R14 | Lateness source merge | For attendance fallback, effective minutes = max(recomputed vs shiftStart, stored client `minutesLate`) | `generate:303-306` | att.checkIn, shiftStart | minutes |
| R15 | Compliance formula | (present + late + exempt + bonus) / ALL calendar days-to-today × 100, capped 100 | `generate:432-436`; `employee-detail:506-511` | day counts | % |
| R16 | Working-day definition | All calendar days incl. weekends; comment claims "not penalized" but code has no weekend exclusion | `generate:40-51, 91, 430` | month | day list |
| R17 | Rule config sync | `deductionRules` DB values force-overwritten to hardcoded canonical amounts on every report run (write-on-read) | `generate:16-29, 97`; `employee-detail:18-31` | — | DB writes |
| R18 | External deduction merge | Approved `hrDeductions` (days+EGP) + `qualityDeductions` added into `totalDeductionDays` | `generate:139-151, 416-426` | hr/quality recs | totals |
| R19 | HR merge divergence | `employee-detail.totalDeductionDays` = attendance + quality only (HR excluded from the total) | `employee-detail:503-504` | same | different total |
| R20 | Late display bands | Badge color thresholds at 30/60 min (UI only, no policy effect) | `AttendancePage.tsx:339-345` | minutesLate | color |
| R21 | Compliance bands | Green ≥90, amber ≥75, red <75 (UI + Excel coloring) | `ReportsPage.tsx:432-449`; `export/route.ts:222-233` | compliance | styling |
| R22 | "Problem" flags | compliance <75 OR absent >2 OR totalDeduction >1; late red if >3 | `ReportsPage.tsx:414-418, 732, 755-760` | row stats | UI flags |
| R23 | E360 recommendations | absent >6 → improvement plan; late >5 → follow-up | `employee-360/[id]:290-291` | attendance counts | text |
| R24 | AOCC rate | Dept attendanceRate = (present + late×0.5)/total × 100 | `aocc/event-collector.ts:619` | today counts | % |
| R25 | Risk weights | Late/absent day counts feed weighted employee risk score | `metrics/riskMetrics.ts:171-172` | attendance counts | risk points |

---

## §5 Current Source of Truth — per Metric (brief §9)

| Metric | Source of truth today | Inconsistency (verified) |
|---|---|---|
| Monthly present/late/absent/exempt | On-the-fly computation in `reports/generate` from biometrics+attendance+requests+waivers | `employee-detail` computes the same thing separately and **diverges** on excuse handling (R9) and total deduction (R19) |
| Deduction days (attendance policy output) | Same on-the-fly computation; persisted **nowhere** | Excel export renders client-held rows, so printed values can be stale vs a fresh regenerate |
| Lateness minutes | `biometrics.checkIn` vs `employees.shiftStart` (report-time), or client-computed `attendance.minutesLate` (stored) | Mixed provenance: one page recomputes from raw fingerprint; the daily page trusts a browser-computed stored number (R14 merges both) |
| "Attendance rate / compliance" | THREE different formulas: reports R15; E360 simple counts; AOCC R24 | Same word, three answers depending on screen |
| Today's presence/absence | `attendance` collection only (home stats `getTodayStr` match) | Days with fingerprint but no manual record show as "no data"; daily page has no link to biometrics |
| Employee name on records | Join at read time (`withEmployee`) | Biometric import auto-creates employees; duplicate names misattribute silently |
| Deduction amounts | Hardcoded `CANONICAL_RULES` constants | `deductionRules` collection is a mirror that is force-resynced — not an editable source |
| Waivers | `waivedDeductions` (only persisted policy correction) | Restore deletes **all** types for a date, not just one type (`waive-deduction/route.ts:62` — `deleteWhere` without `deductionType`) |

---

## §6 Existing Problems (verified only)

### Data integrity
1. **Fingerprint re-upload duplication** — no dedup/idempotency (`biometric/upload` creates unconditionally); a re-uploaded month double-counts unless manually cleared first.
2. **Employee auto-creation from spreadsheet rows** (`upload/route.ts:116-124`) pollutes the master registry; combined with (3) it silently shifts future attributions.
3. **Duplicate-name first-match misattribution** (`upload/route.ts:112`).
4. **Free-text dates everywhere** — attendance/request POST/PATCH accept any string; unpadded or malformed dates silently vanish from month filters and the report engine.
5. **Unvalidated PUT merge** on attendance (`[id]/route.ts:18`) — arbitrary field writes; `minutesLate` goes stale after edits (never recomputed server-side).
6. **Orphan `approvedRequestId`** — deleting an excuse request leaves its auto-created attendance record behind.
7. **Write-on-read side effect** — every report run mutates `deductionRules` (`syncRulesToCanonical`); concurrent runs race; GET-style routes performing writes violates the audit trail expectations elsewhere in the system.
8. **Excuse double-implementation** — deduction decided in request-approval notes AND re-derived in the report; the two engines then disagree (R9).
9. **Broken UI endpoints** — `/api/attendance/upload` and `/api/requests/upload` buttons 404.
10. **Attendance list sort is a no-op** — `sortByDateField` on DD/MM/YYYY yields NaN comparators (`attendance/route.ts:36`; masked by client re-sort).
11. **Dead `biometrics.month` field** — written, never read; month logic re-parses strings.
12. **Dead validation** — `validateEmployeeId`'s `isSuspended` check reads a field nothing writes; there is no real inactive-employee concept.

### Business logic
13. **Duplicated policy core** with verified divergences R9/R19 — the same employee/month shows different totals on the company report vs the detail drill-down.
14. **Hardcoded policy constants** scattered (grace 15 ×3 copies; allowance 4 ×2 copies + UI `/4`; canonical amounts ×2 copies) — no single place to change policy.
15. **Weekend/weekly-off mismatch** — code comment says weekends are not penalized; mechanically every record-less day is an absence (R16). With only a 4-day monthly allowance, ~8–9 weekend days for a Mon–Fri employee would surface as deductions unless fingerprints/requests exist for them. This needs a business ruling; today the code decides silently.
16. **Client-computed policy trusted by server** (`minutesLate` from the browser).
17. **HR role cannot upload fingerprints** (permission preset omits `biometric: upload`) though HR is the uploading persona — may be intentional, worth confirming.

### UX
18. **Daily vs monthly confusion** — two nearly identical check-in/out tables ("البصمة" and "الحضور والانصراف") with no explanation of their different roles and no cross-links; neither shows the other's data.
19. **No weekly-off / holiday state** in daily attendance (statuses only present/late/absent/approved) — an employee's rest day appears as "no record".
20. **No fingerprint↔daily comparison feature** exists despite the conceptual intent described for Daily Attendance.
21. **Report results vanish** with the tab (sessionStorage only); no server-side month result to audit later.

---

## §7 Duplication / Architecture Debt (verified)

| Debt | Evidence |
|---|---|
| ~500-line near-identical calculation cores in two routes | `generate/route.ts` vs `employee-detail/route.ts` (CANONICAL_RULES, syncRulesToCanonical, calcLateMinutes, getLateRuleKey, precedence ladder, allowance post-processing all duplicated) |
| Policy constants triplicated across tiers | R1/R7/R21 citations above |
| Third lateness implementation in the browser | `AttendancePage.tsx:80-94` |
| Three "attendance rate" formulas | R15 vs E360 counts vs R24 |
| Data layer stringly-typed dates | DD/MM/YYYY strings + substring month matching throughout |
| Report export trusts client data | `export/route.ts:13-14` |
| Generic `rules-engine.ts` name suggests policy ownership it doesn't have | It is notification automation only |
| Route-level business logic (no domain/service layer) | all policy lives inside API route handlers and one page component |

---

## §8 Performance Findings (verified)

1. **Full-table RTDB reads everywhere** — `getAll` fetches entire collections (`db.ts:58-70`); every query filters in memory (`findWhereContains` loads the whole table first). `biometrics` grows ~employees×days monthly and is fully loaded by: report generate, employee-detail, biometric page, Employee360, home stats.
2. **Report generation cost** — 8 parallel full-table loads + `syncRulesToCanonical` doing up to 5 sequential `findFirst` (each itself a full `getAll` of `deductionRules`) + writes; then E×D nested loop (employees × all calendar days).
3. **Employee360** loads full `followUps`, `travelDeals`, `complaints`, `capaCases` tables to serve **one** employee (`employee-360/[id]:66-69`).
4. **No month-keyed indexing or partitioning** — month scoping is always substring post-filtering; RTDB path structure `arm_erp/<table>/<id>` offers no month sharding.
5. **Recompute-everything model** — no persisted monthly result; every report view, detail expansion, and export regenerates from raw inputs.
6. **Mitigations present**: in-memory TTL cache (5–60s) and `getAllBatch` reduce repeated reads within a window (`db.ts:17-105`); cache is per-instance (serverless/multi-instance deployments get cold caches) and invalidated per-table on writes.

---

## §9 Target Attendance Engine Architecture (PROPOSAL ONLY — no implementation in this milestone)

### 9.1 Target shape

```
RAW FINGERPRINT (biometrics, unchanged)
      ↓
Fingerprint Normalization      [pure lib: parse/normalize/dedupe/match report]
      ↓
Attendance Day Record Model    [canonical per employee-day view: bio + att + request + waiver]
      ↓
Attendance Policy Engine       [pure functions, config-driven rules R1–R19]
      ↓
Monthly Attendance Result      [persisted, month-keyed snapshot — Phase-1 monthSnapshots precedent]
      ↓
PerformanceFactor adapter      [reuses kpi-scoring.toPerformanceFactor as-is]

DAILY ATTENDANCE (unchanged responsibility)
      ↓
HR Verification Layer          [present/absent/weekly-off/manual verify; may READ engine output]
      ↓
Operational Attendance Status  [today picture only — never a deduction source]
```

### 9.2 Proposed structure (future milestone)

- `src/lib/attendance/types.ts` — `AttendancePolicyConfig`, `AttendanceDayInput`, `DayEvaluation`, `MonthlyAttendanceResult`.
- `src/lib/attendance/policy.ts` — pure day-evaluation (the R1–R19 ladder) taking an explicit config (grace, tiers, allowance, weekend policy) — no I/O.
- `src/lib/attendance/monthly-engine.ts` — pure aggregation employee×month → `MonthlyAttendanceResult`.
- `src/lib/attendance/normalize.ts` — fingerprint row → canonical day record (single place for date/time formats, matching, dedup idempotency keys).
- API: new thin routes wrap the lib; existing `/api/reports/generate` + `/employee-detail` become adapters that call the same lib (removing the duplication without breaking callers/UI).
- Persistence (later): `attendanceResults` month-keyed docs (pattern: `monthSnapshots`), written on explicit generate/close, read by all consumers.

### 9.3 PerformanceFactor compatibility (brief §14 — adapter explained, not built)

Phase 1 already provides the generic primitive in `src/lib/kpi-scoring` — `PerformanceFactor {factorId, factorName, score, maxScore, weight, normalized, breakdown}` (`types.ts:97-110`) and `toPerformanceFactor()` (`score-calculator.ts:125-142`), which is pure and domain-agnostic by design ("Attendance, Sales ... expose the same interface", `types.ts:5-7`). The future Attendance Engine needs **zero changes to that infrastructure**: it computes a `MonthlyAttendanceResult`, then calls `toPerformanceFactor('attendance', 'الحضور', scoreResult, weight, {lateDeductionDays, absenceDeductionDays, presentDays, exemptDays})`. The score can be derived from the existing compliance figure (R15) or from deduction days via `computeScoreFromAdjustments` — a Milestone-2+ decision; either maps without touching `kpi-scoring`.

### 9.4 Monthly vs Daily responsibility separation (brief §15 — to be preserved)

| Monthly Fingerprint track | Daily Attendance track |
|---|---|
| Official monthly attendance calculation | Today's verification: present / absent |
| Attendance policy application (deductions) | Weekly-off / rest-day visibility (once modeled) |
| Monthly result + deduction days for salary/reports | HR manual verification & correction |
| Reads: biometrics + attendance + requests + waivers | May *read* engine output for context; never writes deductions |
| Never merged into one dataset or calculation with daily | Does not replace the monthly engine |

The future engine must keep these as two consumers of a shared *day-record model*, not one combined calculation.

### 9.5 Migration / backward compatibility (brief §16 — strategy only)

- Legacy `biometrics` / `attendance` / `requests` / `waivedDeductions` remain untouched and remain the raw sources of truth until parity is proven.
- The future canonical `MonthlyAttendanceResult` is **additive** (new collection), generated alongside; existing reports keep their exact output shape so Excel exports and HR workflows don't break.
- Salary/report backward compatibility continues to be satisfied by the existing generate/export contract; only after golden-test parity (current engine vs new lib on real months) do consumers switch reads.
- Employee auto-creation from fingerprint uploads should be frozen in a later milestone (flagged, not changed now); existing auto-created employees stay for compatibility.

---

## §10 Recommended Milestone 2

**Goal: extract the calculation core into one pure library with provable parity — no UI changes, no data migration, no KPI.**

1. Create `src/lib/attendance/` (types + policy + monthly-engine) encoding the verified ladder R1–R19 with an explicit `AttendancePolicyConfig` (grace 15, late tiers 16-30/31-60/61+, absence 1, single-fingerprint 0.5, allowance 4, weekend policy flag).
2. Rewire `/api/reports/generate` and `/api/reports/employee-detail` to call the library (thin adapters, identical response shapes).
3. **Resolve the two divergences by explicit business decision before coding:** R9 (excuse day: 1–2 deduction days vs exempt) and R19 (HR deductions inside vs outside totalDeductionDays) — then encode the decision once.
4. Golden/parity tests: fix current engine outputs for sample months as fixtures; new lib must reproduce them exactly (Phase-1 style test discipline).
5. Move `syncRulesToCanonical` out of the read path (one-time seed script or startup check) — behavioral no-op, removes write-on-read.
6. Add date-format validation at the API boundary (accept padded DD/MM/YYYY only) — protective, non-breaking.
7. Explicitly OUT of scope for M2: Attendance PerformanceFactor adapter, persisted monthly results/snapshots, daily-attendance redesign (weekly-off states, fingerprint comparison), repairing the two 404 upload endpoints unless trivially included, employee identity overhaul.

Milestone 3+ candidates (in order): persisted `MonthlyAttendanceResult` snapshots; PerformanceFactor adapter + Employee 360/Home/AOCC switch to canonical results; daily verification layer with weekly-off; fingerprint import idempotency.

---

*Audit method: full read of all attendance/fingerprint/report/deduction code paths, cross-checked by project-wide search (attendance, fingerprint, بصمة, overtime, holiday, weekly-off, early-departure, salary). No code or data was modified.*
