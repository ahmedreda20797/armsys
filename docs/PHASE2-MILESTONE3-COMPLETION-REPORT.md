# ARM ERP — Phase 2: Enterprise Attendance & Policy Engine
## Milestone 3 Completion Report — Persisted Monthly Attendance Results

**Date:** 2026-08-16
**Predecessors:** `docs/PHASE2-MILESTONE1-ATTENDANCE-AUDIT.md`, `docs/PHASE2-MILESTONE2-COMPLETION-REPORT.md`

---

## §1 Files Created

| File | Purpose |
|---|---|
| `src/lib/attendance/monthly-results.ts` | Persisted-result layer: `StoredAttendanceResult` type, deterministic composite identity, policy fingerprint, raw-input adapter (`buildMonthlyInputIndex`), pure persistence/audit builders, generation orchestrator, read helpers |
| `src/app/api/attendance-results/generate/route.ts` | `POST /api/attendance-results/generate` — authenticated, permission-gated, month-validated generation |
| `src/app/api/attendance-results/[month]/route.ts` | `GET /api/attendance-results/[month]` — stored-results list (employeeId/department filters, offset/limit) |
| `src/app/api/attendance-results/[month]/[employeeId]/route.ts` | `GET /api/attendance-results/[month]/[employeeId]` — single stored result; explicit `not_generated` 404 |
| `src/lib/attendance/__tests__/monthly-results.test.ts` | 16 Milestone 3 tests (parity, adapter, idempotency, policy traceability, isolation, audit) |
| `scripts/milestone-3-runtime-verification.ts` | Read-only runtime verification against the real Firebase RTDB |
| `docs/PHASE2-MILESTONE3-COMPLETION-REPORT.md` | This report |

## §2 Files Modified

| File | Change |
|---|---|
| `src/lib/attendance/index.ts` | Barrel re-exports the monthly-results public API (+ header note) |

Untouched per scope lock: the canonical engine files (`types.ts`, `policy.ts`, `monthly-engine.ts`, `dates.ts`, `rule-config.ts`, `report-compat.ts`), both report routes, attendance/requests/waiver/biometric APIs and collections, Quality, HR, Workflow, AOCC, notifications, fingerprint importer, `db.ts`, permission architecture, audit library. **The canonical Attendance Engine was not modified** — it is consumed as-is.

## §3 attendanceResults data model

New **additive** RTDB collection (legacy inputs `biometrics`/`attendance`/`requests`/`waivedDeductions` untouched):

```
arm_erp/attendanceResults/{id}    id = `${YYYY-MM}_${employeeId}`   (deterministic composite identity)
```

`StoredAttendanceResult` = the engine's `MonthlyAttendanceResult` **verbatim** (`employeeId`, `month`, `workDays`, `presentDays`, `lateDays`, `absentDays`, `exemptDays`, `unaccountedDays`, `bonusDays`, `autoExemptDays`, `totalMinutesLate`, `lateDeductionDays`, `absenceDeductionDays`, `attendanceDeductionDays`, `effectiveWorkingDays`, `compliance`, `daily: DayEvaluation[]`) plus metadata only:

| Field | Content |
|---|---|
| `schemaVersion` | `1` |
| `employeeSnapshot` | `{ employeeId, employeeName, department, position }` (display copy; identity remains employeeId) |
| `policySnapshot` | Deep copy of the **resolved** `AttendancePolicyConfig` at generation time (grace, late thresholds/deductions, absence, single fingerprint, free allowance, excuse config, weekend policy) |
| `policyFingerprint` | 8-hex FNV-1a over a stable (key-sorted) serialization of the resolved policy |
| `engineVersion` | `'attendance-v1'` (deterministic marker; bump on future engine/policy-logic change) |
| `generatedAt` / `generatedBy` | ISO timestamp + `{ id, name }` actor of the generation run |
| `createdAt` / `updatedAt` | Set by the existing db helpers (createdAt survives regeneration) |

Attendance-domain deductions only (Decision E / R19): no HR, no Quality values anywhere in the record.

## §4 Generation API

`POST /api/attendance-results/generate` — body `{ month: "YYYY-MM" }`:

1. `verifyPermission(request, 'attendance', 'update')` — generation writes the canonical attendance-domain result collection, so the existing attendance edit permission gates it (admin always passes; no new permission keys).
2. Strict month validation (`validateMonthKey`).
3. Actor resolved server-side (`resolveActor`) — never client-supplied.
4. Delegates to `generateMonthlyAttendanceResults(month, actor)`:
   loads the month's raw inputs **batched** (`employees`, `deductionRules`, month-scoped `biometrics`/`attendance`/`requests` via `findWhereContains`, `waivedDeductions` by month — the Milestone 2 report-adapter loading pattern; no N+1 employee reads), resolves the current policy, calls `computeMonthlyAttendance()` **once per employee** (`asOf = new Date()` — legacy current-month cutoff; a server-side explicit input), builds the stored records via the pure builder, plans idempotent writes, persists, audits, invalidates the cache.
5. Returns the typed summary (§12 shape):
   `{ success, month, employeesProcessed, resultsCreated, resultsUpdated, failed, generatedAt, engineVersion }`.

No attendance rule lives in the route or the service — the persisted value is the direct serialized engine output.

**Generation semantics (documented):** this is NOT Close Month. Open and historical months may be regenerated when explicitly requested; the persisted result is a canonical generated result, not yet a frozen payroll snapshot. Formal monthly locking belongs to a later milestone.

## §5 Read API

| Route | Behavior |
|---|---|
| `GET /api/attendance-results/[month]` | Stored results for the month; optional `employeeId` (exact), `department` (on `employeeSnapshot.department`), `offset`/`limit`; deterministic employeeId ordering; response `{ month, results, meta: { count, total } }` |
| `GET /api/attendance-results/[month]/[employeeId]` | One stored result, or **404 `{ status: 'not_generated', month, employeeId }`** |

Both are gated by `'view'` on `'reports'` — the same permission that protects `/api/reports/generate`, which serves the same canonical computation without persistence.

**Read semantics (critical, §14):** reads NEVER recalculate. `getAttendanceResultsForMonth` / `getAttendanceResult` read the collection only; a missing result surfaces the explicit `not_generated` state. Regeneration happens exclusively through the generate endpoint.

## §6 Idempotency behavior

- Identity is deterministic: `attendanceResultId(month, employeeId)` → same employee/month always resolves to the same document. Duplicate results for one employee/month are structurally impossible.
- First generation → `createRecordWithId` (create). Regeneration → `updateRecord` replace-merge under the same id (update) — the write plan (`planResultWrites`) classifies by canonical employeeId against the month's existing records.
- Content is deterministic for fixed inputs + policy + engine version (tested); `generatedAt`/`generatedBy` re-stamp per run, `createdAt` survives as the first-generation anchor.
- Concurrency: RTDB exposes no CAS through the db.ts helpers; two simultaneous generations may both compute but converge on the same ids — worst case one redundant replace, never duplicates (same note as the Quality `closeMonth` service).
- Generation history/audit is preserved via the audit log (§10), not via duplicate documents.

## §7 Policy snapshot / versioning

Every persisted result freezes the full resolved `AttendancePolicyConfig` (defaults ⊕ `deductionRules` overlay) as `policySnapshot`, plus a deterministic `policyFingerprint` (FNV-1a over key-sorted stable JSON — no new hashing infrastructure) and `engineVersion: 'attendance-v1'`. The builder deep-copies the policy, so later configuration changes can never mutate a stored historical result (tested by mutating the policy object after build). "Which attendance rules produced this result?" is answerable from the document alone; a future engine becomes `attendance-v2` and stays historically distinguishable.

## §8 Employee identity / snapshot behavior

Results are keyed by canonical `employeeId` only — never name/email/mobile/fingerprint name. A display snapshot (`employeeId`, `employeeName`, `department`, `position`) is copied onto the record for historical readability; it does not make the result immutable. Records belonging to employees absent from the `employees` table are ignored by the adapter (same loop-over-employees semantics as the report adapters); results for employees deleted after generation remain (documented limitation, §15).

## §9 Audit behavior

Uses the existing generic audit infrastructure (`writeAudit`) into a new per-domain `attendanceAuditLog` collection (the `qualityAuditLog`/`hrAuditLog` pattern) — no new audit framework. Each generation run writes:

- one month-level `generate_month` entry (entityType `attendanceMonth`, run counts, engineVersion, policyFingerprint, generatedAt);
- one `generate` (create) or `regenerate` (replace) entry per employee result (entityType `attendanceResult`, entityId = result id, `monthKey`, compact before/new result metadata — never the full daily array).

Actor, timestamp, action, scope, previous/new metadata, engineVersion and policy fingerprint are therefore all recorded. Audit writes are fire-safe (never throw into the primary operation).

## §10 Cache strategy

Existing `db.ts` in-memory cache only — no second caching system. Writes invalidate the `attendanceResults` table cache per db-helper plus one explicit `invalidateCache(ATTENDANCE_RESULTS_TABLE)` after the write loop; list reads use `TTL.STATIC` (60s — safe because only generation mutates the table and generation invalidates). No global cache clearing.

## §11 Golden / parity results

16 new tests (`npx tsx --test src/lib/attendance/__tests__/monthly-results.test.ts`, all passing):

- **Numerical parity (§29):** the Milestone 2 golden month (July 2026 mixed fixture) is computed through the raw-input adapter + canonical engine and persisted via the builder; every `MonthlyAttendanceResult` field is asserted equal to the engine output (expectations derived from the engine, not re-typed), anchored to the M2 golden totals (attendanceDeductionDays 11.25, compliance 61, lateDeduction 3.25, absenceDeduction 8; `daily` preserved verbatim, 31 entries).
- **Adapter parity:** latest-request-wins by `createdAt`; malformed legacy dates dropped (engine would throw — the pre-filter is what keeps generation safe on legacy data); waiver default `all`; unknown-employee records ignored.
- **Idempotency:** identical inputs → deep-equal records; regeneration plans exactly ONE replacement under the same id (never a duplicate); mixed-month created/updated classification.
- **Policy traceability:** stored snapshot equals the resolved policy including the `deductionRules` overlay; post-build policy mutation never leaks into the stored snapshot; fingerprint deterministic, key-order independent, distinguishes configurations.
- **Multi-employee:** same month → two isolated results keyed by canonical ids; one employee's data never affects the other's record.
- **Audit:** month anchor + per-employee create/replace entries with before/after metadata, monthKey, engineVersion, policyFingerprint.

## §12 Runtime verification result

`npx tsx scripts/milestone-3-runtime-verification.ts [month]` (strictly read-only, milestone-9 pattern), run against the production RTDB for 2026-08 and 2026-07:

- `attendanceResults` collection absent/empty (additive — nothing persisted yet) ✔
- Dry-run generation on real data: **2026-07 → 82/82 employees computed, 0 failures** with 600 real biometric records through the full load → index → engine → builder pipeline; sample record carried the deterministic id, engineVersion `attendance-v1`, policy fingerprint `909496dc`, full policy + employee snapshots and the 31-day breakdown ✔
- Read semantics: list read returns `[]` and single read returns `null` → explicit `not_generated`, no recalculation ✔
- **RUNTIME WRITE VERIFICATION — BLOCKED BY ENVIRONMENT SAFETY** (production-only Firebase environment; no writes were performed — persisted generation must be triggered explicitly by an authorized admin via `POST /api/attendance-results/generate` when deemed safe).

## §13 Verification gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | 19 errors — **identical to the pre-change baseline** (pre-existing: quality-kpi panel, kpi-dashboard/riskMetrics/quality-migration tests, workflow engine). Zero errors in any Milestone 3 file. |
| `npm run lint` (touched files) | Clean — `src/lib/attendance/**`, `src/app/api/attendance-results/**`, the verification script. (Project-wide pre-existing backlog unchanged.) |
| `npm test` | 477 tests (was 461): **476 pass, 1 fail** — the single failure is the pre-existing `quality-migration.test.ts` baseline failure, untouched. All 16 new tests pass; all 51 Milestone 2 attendance tests still pass. |
| Focused attendance suite | 67/67 passing (51 M2 + 16 M3). |

## §14 Backward compatibility status

- `POST /api/reports/generate` and `POST /api/reports/employee-detail` are **unmodified** — they keep computing through the canonical engine on every request. No consumer was switched to persisted results (explicitly deferred).
- No existing collection, route, UI page, permission key, notification, or cache behavior changed. The only shared-file change is additive barrel exports.
- The new endpoints are purely additive; nothing references them yet.

## §15 Known limitations

1. **No Close/Reopen semantics** — historical months are regenerable on request; the persisted result is not yet immutable (by design; later milestone).
2. **No CAS on generation** — concurrent duplicate generations converge on the same ids (worst case: redundant replace + duplicate audit entries).
3. **Stale results after employee deletion** — results of employees removed from `employees` persist until the month is regenerated with the shrunk roster.
4. **asOf is the generation-time server clock** — a current-month result frozen mid-month reflects the cutoff day it was generated on (legacy report semantics; regeneration refreshes it).
5. **No runtime write verification** — production-only environment; first real generation is deliberately left as an explicit admin action.
6. Pre-existing baseline untouched: 19 tsc errors, 1 failing quality-migration test, lint backlog, Milestone-1 known issues (404 upload buttons, fingerprint re-upload duplication, employee auto-creation).
7. Generation currently processes the whole company roster for the month; single-employee generation and scheduling are future conveniences, not required by any current consumer.

## §16 Recommendation for Milestone 4

**Migrate readers to the persisted canonical results — one consumer at a time, starting with Employee 360:**

1. Add a generation trigger to the reports workflow (explicit button/call to `POST /api/attendance-results/generate`; optionally generate-on-report-view later).
2. Run a one-real-month parity harness (persisted `attendanceResults` vs live `computeMonthlyAttendance` for every employee) before flipping any reader — the runtime dry-run script already proves the pipeline; extend it to post-generation comparison.
3. Switch **Employee 360** attendance figures to `GET /api/attendance-results/[month]/[employeeId]` (falling back to live computation only when `not_generated`), removing the first of the three inconsistent formulas found in the Milestone 1 audit.
4. Then Home stats, then AOCC — one decision per step, each gated by the parity harness.
5. Keep Close/Reopen, Attendance KPI/PerformanceFactor, daily reconciliation, and fingerprint idempotency out of scope until readers are unified.

---

**Status:** Milestone 3 complete. No Milestone 4 work started. No existing consumer switched.

ATTENDANCE MILESTONE 3 — COMPLETE
