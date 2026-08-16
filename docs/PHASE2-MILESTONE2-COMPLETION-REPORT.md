# ARM ERP — Phase 2: Enterprise Attendance & Policy Engine
## Milestone 2 Completion Report — Canonical Attendance Calculation Engine + Golden Parity Tests

**Date:** 2026-08-16
**Predecessor:** `docs/PHASE2-MILESTONE1-ATTENDANCE-AUDIT.md` (audit §4 rule inventory, §6 R9/R19 divergences)

---

## §1 Files Created

| File | Purpose |
|---|---|
| `src/lib/attendance/types.ts` | Pure domain types: `AttendancePolicyConfig`, `AttendanceDayInput`, `DayEvaluation`, `MonthlyAttendanceResult`, excuse/weekend/waiver types |
| `src/lib/attendance/dates.ts` | DD/MM/YYYY validation (`parseLegacyDate`, `isValidLegacyDate`), legacy month calendar (`getEvaluatedDates`), `formatMinutes`, `round2` |
| `src/lib/attendance/policy.ts` | Canonical day evaluation (`evaluateDay`), late tiers (`resolveLateTier`), excuse classifier (`classifyExcuse`) — zero I/O |
| `src/lib/attendance/monthly-engine.ts` | `computeMonthlyAttendance()` — calendar walk, free-absence allowance, totals, compliance |
| `src/lib/attendance/rule-config.ts` | `DEFAULT_ATTENDANCE_POLICY`, `resolveAttendancePolicy()` (DB overlay), `ensureDeductionRulesSeeded()` (idempotent seed), `CANONICAL_DEDUCTION_RULES` |
| `src/lib/attendance/report-compat.ts` | Pure legacy response mappers: `buildReportRow()`, `buildDailyBreakdown()` (incl. legacy Arabic source strings) |
| `src/lib/attendance/index.ts` | Public barrel |
| `src/lib/attendance/__tests__/policy.test.ts` | Day-level golden matrix (26 tests) |
| `src/lib/attendance/__tests__/monthly-engine.test.ts` | Month aggregation, allowance ladder, R9 outcomes, boundaries, validation (15 tests) |
| `src/lib/attendance/__tests__/report-compat.test.ts` | Legacy row/breakdown parity + R19 matrix (6 tests) |
| `src/app/api/deduction-rules/seed/route.ts` | `POST /api/deduction-rules/seed` — explicit one-time seed (replaces write-on-read sync) |
| `docs/PHASE2-MILESTONE2-COMPLETION-REPORT.md` | This report |

## §2 Files Modified (only what the scope lock allows)

| File | Change |
|---|---|
| `src/app/api/reports/generate/route.ts` | Rewritten as thin adapter over the canonical engine; response shape preserved; month-key validation added; `syncRulesToCanonical` write-on-read removed |
| `src/app/api/reports/employee-detail/route.ts` | Same adapter treatment; R9/R19 resolutions applied (below); month-key validation added |
| `src/app/api/attendance/route.ts` | POST rejects malformed/non-calendar DD/MM/YYYY dates (§22) |
| `src/app/api/attendance/[id]/route.ts` | PUT rejects malformed `date` when present (§22); checkout updates without `date` unaffected |

Untouched per scope lock: Quality KPI engine, observations, snapshots, Daily Attendance UI, BiometricPage, Requests UI/API (incl. the excuse-approval side effect), waiver API, export route, salary (none exists), Workflow, AOCC, Sales, fingerprint importer, database schema/data.

## §3 Canonical Engine Architecture

```
biometrics + attendance + requests + waivers   (loaded by API adapters, Firebase only there)
                ↓ date-keyed records
AttendanceDayInput + AttendancePolicyConfig
                ↓ policy.evaluateDay()            (pure, per-day precedence ladder)
DayEvaluation
                ↓ monthly-engine.computeMonthlyAttendance()   (pure; allowance + totals + compliance)
MonthlyAttendanceResult                        (attendance-domain ONLY — R19)
                ↓ report-compat.buildReportRow / buildDailyBreakdown   (pure legacy mappers)
API responses (legacy field contracts)  ←  quality + hrDeduction composed by the adapters
```

The engine performs **zero** Firebase/HTTP/React/clock calls; `asOf` is an explicit input (adapters pass `new Date()` server-local, preserving legacy cutoff semantics). `weekendPolicy: { mode: 'all-days-count' }` is the only implemented mode — the verified legacy behavior (all calendar days evaluated; the misleading legacy "weekends not penalized" comment is documented, not silently changed). Any real weekend policy is a future explicit config decision.

## §4 Policy Rules Implemented (config-driven, audit §4 → config mapping)

| Rule | Config field | Default |
|---|---|---|
| Grace minutes | `graceMinutes` | 15 (late starts at 16) |
| Late 16–30 → ¼ day | `late15Threshold` / `late15DeductionDays` | 30 / 0.25 |
| Late 31–60 → ½ day | `late30Threshold` / `late30DeductionDays` | 60 / 0.5 |
| Late 61+ → 1 day | `late60DeductionDays` | 1 |
| Absence day | `absenceDeductionDays` | 1 |
| Single fingerprint | `singleFingerprintDeductionDays` | 0.5 |
| Free absence allowance / bonus days | `freeAbsenceAllowance` | 4 |
| Excuse rules (Decision D) | `excuse.*` | normal 1 / exempt 0 / rejected 2 / pending 1 |
| Weekend behavior | `weekendPolicy.mode` | `all-days-count` (legacy) |

Late-tier/absence/single-fingerprint **amounts** additionally overlay from the `deductionRules` collection via `resolveAttendancePolicy()` (missing/invalid rows → canonical defaults).

Precedence ladder preserved verbatim: P1 excuse-linked attendance → P1b approved attendance → P2 approved request → P3 biometric check-in (+missing-checkout) → P4 biometric checkout-only → P5 attendance fallback → P6 request-only → P7 no-record.

## §5 R9 Resolution (excuse divergence)

Old conflict: `generate` charged approved-excuse days 1–2 days; `employee-detail` exempted them. Canonical rules (Decision D), encoded once in `policy.ts` P1:

| Request state | Category | Result |
|---|---|---|
| approved | normal | absent + `normalApprovedDeductionDays` (1) |
| approved | medical / accident-emergency | absent + 0 |
| rejected | any | absent + `rejectedDeductionDays` (2) |
| pending | any | absent + `pendingDeductionDays` (1), `unaccounted` + `pendingFinalization` flags — provisional, never silently finalized; participates in the free-absence allowance exactly like legacy |
| request record missing (deleted request, orphan attendance) | — | absent + 1, `unaccounted` |

Category resolution (`classifyExcuse`): ① structured field (`category`: `medical` / `accident` / `emergency`) when a record carries one — **no such field exists today**; ② config-driven keyword mapping over `reason` (`medicalPatterns` / `accidentPatterns`, Arabic + English defaults); ③ `normal`. **Documented limitation (§6 of the brief):** the current Request model has no structured category field; the interim mapping lives entirely inside `AttendancePolicyConfig` (configurable, testable, overridable — not substring checks scattered in routes/APIs). A future structured field wins automatically once written.

Both routes now produce the identical canonical result; the old independent detail calculation no longer exists.

## §6 R19 Resolution (HR deduction separation)

- `MonthlyAttendanceResult` carries **attendance-domain deductions only** (`lateDeductionDays`, `absenceDeductionDays`, `attendanceDeductionDays`). HR deductions are not an engine input at all.
- Adapters compose the legacy row/reportSummary with explicit, separately named values: `totalAttendanceDeductionDays`, `totalQualityDays`, `totalQualityAmount`, `totalHrDeductionDays`, `totalHrDeductionAmount`, `hrDeductionCount`.
- `totalDeductionDays` keeps the **legacy generate composition** (attendance + quality + HR) because ReportsPage and the Excel export consume it (verified consumers: ReportsPage lines 418/484–486/793, export route rows).
- **Intentional change (documented):** employee-detail's `reportSummary.totalDeductionDays` previously excluded HR days (attendance + quality only); it now uses the same composition as generate so both views agree for the same employee/month. Additive fields `totalHrDeductionDays` / `totalHrDeductionAmount` / `hrDeductionCount` were added to the detail summary (superset — no consumer breaks).

## §7 Requests / Daily / Fingerprint integration posture

- **Requests (Decision A):** read-only workflow input; the engine distinguishes type + approved/rejected/pending; request management stays in the Requests page; the existing excuse-approval side effect (auto-created attendance record) is untouched and remains the only writer of `approvedRequestId`.
- **Daily Attendance (Decision B):** unchanged operational tool; not a deduction source on its own (P5 fallback within the engine, as legacy); no policy duplicated there; date inputs now validated at the API boundary.
- **Monthly Fingerprint (Decision C):** importer untouched; biometrics remain the primary P3/P4 source feeding the canonical engine.

## §8 Deduction-rule configuration behavior (§27)

- `syncRulesToCanonical()` (write-on-read inside every report run) **removed** from both routes.
- `resolveAttendancePolicy()` reads the collection read-only; DB rows with finite numeric amounts win, missing/invalid fall back to canonical defaults. Since the legacy sync had already forced every deployment's rows to canonical values, resolved numbers are identical today; amounts edited via `/api/deduction-rules` now actually take effect (previously cosmetic) — documented behavior change.
- New explicit `POST /api/deduction-rules/seed` (`requireAuth`, mirroring the `rules/seed-capa-templates` precedent) seeds **missing** canonical rows only; never overwrites. READ report ≠ WRITE policy config.

## §9 Legacy report compatibility

- `generate` response: `{rows, meta, summary}` with byte-identical field names/semantics; sort (compliance desc, Arabic name) and summary reducers unchanged.
- `employee-detail` response: `{employee, reportSummary, dailyBreakdown, requests, qualityDeductions, hrDeductions}` preserved (plus the 3 additive summary fields); `dailyBreakdown` keeps the legacy entry shape including Arabic `source` strings, `waivedType`, `autoFree`, and the legacy presentation quirk of showing single-fingerprint deductions inside per-day `absenceDeduction` while totaling them under `lateDeductionDays`.
- Export route unchanged; it still receives the client-held generate rows (contract identical).
- Waive/restore: `waivedDeductions` read path unchanged; waivers still gate `late`/`absence` per day inside the canonical policy (single implementation instead of two).
- Adapters pre-filter records with malformed dates (they could never match a padded calendar key — behavior identical, now explicit).

## §10 Golden / Parity tests (§28–§31)

51 tests, all passing (`npx tsx --test src/lib/attendance/__tests__/*.test.ts`):

- **policy.test.ts (26):** grace boundary 15/16; tier boundaries 16/30/31/60/61; config-driven tier values; missing shift; legacy time tolerance (unpadded/seconds/malformed); single fingerprint in/out; waivers (late/absence/all, status retained); full precedence ladder incl. P1-over-biometric; P5 stored-vs-recomputed minutes merge; P6 rejected/pending; P7 empty; the §30 excuse matrix (normal 1 / medical 0 / accident 0 / rejected 2 / pending provisional / deleted-request 1+unaccounted); structured-category precedence; custom pattern config.
- **monthly-engine.test.ts (15):** golden month (mixed 31-day fixture hand-computed from legacy arithmetic: present 14, late 4, absent 12, exempt 1, minutes 190, lateDeduction 3.25 incl. single-fingerprint, absence 8 after allowance, total 11.25, compliance 61, effective 23, autoFree dates [13,21,22,23]); allowance ladder 0/4/5/6; allowance-from-config; waived-0-day slot consumption; compliance cap at 100 via bonus; minutes only from late days; R9 medical-vs-normal beyond-allowance; rejected-excuse 2 days; pending provisional; leap Feb (29/28); year transition Dec 2025; asOf cutoff; month-start single day; invalid month keys throw; malformed date keys throw.
- **report-compat.test.ts (6):** golden generate row with quality+HR composition (totalDeductionDays = 11.25+1.5+2 = 14.75); §31 R19 matrix (attendance 1 ≠ HR 2, named fields, combined 3); legacy dailyBreakdown sources (biometric late, single-fp suffix, checkout-only, attendance-merge, approved-request label, autoFree suffix, plain absent); waiver suffixes + waivedType passthrough; R9 canonical breakdown rendering (incl. 5th excuse day charged 1); `formatMinutes` cases.

For the R9/R19 cases where the two legacy routes disagreed, the canonical engine encodes the locked business rule and the fixtures assert it (per §29 — the new output is authoritative, the divergence is documented, both routes now match).

## §11 Verification results

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | 19 errors — **identical to the pre-change baseline** (pre-existing: quality-kpi panel, kpi-dashboard/riskMetrics/quality-migration tests, workflow engine/conditions/context). Zero errors in any Milestone 2 file. |
| `npm run lint` (touched files) | Clean — no errors/warnings in `src/lib/attendance/**`, both report routes, seed route, attendance routes. (Project-wide lint has a large pre-existing error/warning backlog — unchanged by this milestone.) |
| `npm test` | 461 tests total (was 410): **460 pass, 1 fail** — the single failure is the pre-existing `quality-migration.test.ts` baseline failure, untouched. All 51 new attendance tests pass. |

## §12 Intentional behavior changes (complete list)

1. **R9:** excuse-linked days in the employee-detail view now show as `absent` with the canonical deduction (1/0/2/provisional 1) instead of the old (buggy) exempt rendering; new Arabic source strings for those days. Company-report numbers unchanged.
2. **R19:** employee-detail `reportSummary.totalDeductionDays` now includes approved HR deduction days (matches generate; previously excluded).
3. Report runs no longer write to `deductionRules`; amounts edited through `/api/deduction-rules` now take effect (previously force-reverted on next report).
4. Malformed `month` keys to both report routes now return 400 (previously produced garbage dates); malformed attendance dates on POST/PUT return 400 instead of being silently stored.
5. Waived/exempt-excuse 0-deduction days still consume free-allowance slots (legacy parity — explicitly preserved and tested, now documented).

## §13 Remaining technical debt (deliberately not addressed)

- Monthly result still ephemeral (no persistence) — Milestone 3.
- Weekend/weekly-off policy still `all-days-count` — awaiting business decision.
- Excuse category still free-text-mapped (config-driven) — needs a structured field later.
- Report adapters still do full-table Firebase reads (legacy pattern preserved per §32).
- Pre-existing baseline: 19 tsc errors, 1 failing quality-migration test, large lint backlog — unrelated files, untouched.
- Known Milestone-1 issues untouched by scope: 404 upload buttons (attendance/requests), fingerprint re-upload duplication, employee auto-creation.

## §14 Recommended Milestone 3

**Persist the canonical Monthly Attendance Result and switch readers to it:**
1. New `attendanceResults` month-keyed documents (reuse the Phase-1 `monthSnapshots` pattern + `month-utils` validation), written on explicit generate (and later, month close).
2. Store the `MonthlyAttendanceResult` + policy-config fingerprint (rule values used) per employee-month for auditability.
3. Switch Employee 360 / Home stats / AOCC attendance figures to read the canonical result (removes the three inconsistent formulas found in the audit — one decision at a time, starting with Employee 360).
4. Parity harness: compare persisted results vs live computation for one real month before flipping readers.

Deferred after that (unchanged from the audit roadmap): Attendance PerformanceFactor adapter, close/reopen month for attendance, daily verification layer with weekly-off modeling, fingerprint import idempotency, employee matching overhaul.

---

**Status:** Milestone 2 complete. No Milestone 3+ work started.
