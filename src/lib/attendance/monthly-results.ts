// ══════════════════════════════════════════════════════════════
//  Persisted Monthly Attendance Results — Milestone 3
//
//  Establishes the canonical, auditable, month-keyed persisted
//  attendance result layer:
//
//    biometrics + attendance + requests + waivedDeductions
//                    ↓ (adapter below — the ONLY Firebase touchpoint)
//    computeMonthlyAttendance()          (canonical engine, unchanged)
//                    ↓
//    StoredAttendanceResult              (engine output + metadata)
//                    ↓ persist (idempotent, deterministic identity)
//    attendanceResults/{month}_{employeeId}
//
//  ARCHITECTURE PRINCIPLE (binding): the persisted record is the
//  DIRECT serialized output of the canonical engine plus metadata
//  (employee snapshot, policy snapshot + fingerprint, engineVersion,
//  generation actor/time). NO attendance rule is recalculated here —
//  this module contains a second calculation of nothing.
//
//  Split (month-snapshots service pattern):
//    • PURE builders  — attendanceResultId, buildPolicyFingerprint,
//      buildMonthlyInputIndex, buildStoredAttendanceResult,
//      planResultWrites, buildResultAuditMetadata,
//      buildGenerationAuditEntries (no DB, unit-testable).
//    • ORCHESTRATORS  — generateMonthlyAttendanceResults,
//      getAttendanceResultsForMonth, getAttendanceResult (wire the
//      builders to db.ts; thin, no rules).
//
//  Generation semantics (Milestone 3 — NOT Close Month): open and
//  historical months may be regenerated when explicitly requested.
//  The persisted result is a canonical generated result, not yet a
//  frozen payroll snapshot; formal monthly locking is a later
//  milestone. Regeneration REPLACES the employee/month record under
//  the same deterministic id (never a duplicate) and is audited.
// ══════════════════════════════════════════════════════════════

import {
  createRecordWithId,
  findWhere,
  findWhereContains,
  getAll,
  getById,
  invalidateCache,
  TTL,
  updateRecord,
} from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import type { WriteAuditInput } from '@/lib/audit';
import { computeMonthlyAttendance } from './monthly-engine';
import { isValidLegacyDate } from './dates';
import { resolveAttendancePolicy } from './rule-config';
import type {
  AttendancePolicyConfig,
  AttendanceRecordInput,
  BiometricPairInput,
  DeductionWaiverType,
  MonthlyAttendanceResult,
  RequestInput,
} from './types';

// ─────────────────────────────────────────────────────────────
//  Constants — collection + versioning
// ─────────────────────────────────────────────────────────────

/** New additive RTDB collection (legacy inputs are never touched). */
export const ATTENDANCE_RESULTS_TABLE = 'attendanceResults';

/** Per-domain audit collection (qualityAuditLog / hrAuditLog pattern). */
export const ATTENDANCE_AUDIT_LOG_TABLE = 'attendanceAuditLog';

/**
 * Deterministic version marker for the canonical calculation logic.
 * Historical results stay attributable to the engine that produced
 * them; a future policy-engine change bumps this to 'attendance-v2'.
 */
export const ATTENDANCE_ENGINE_VERSION = 'attendance-v1';

/** Schema version of the persisted result document itself. */
export const ATTENDANCE_RESULT_SCHEMA_VERSION = 1;

// ─────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────

/** Employee display fields snapshotted onto the result for historical readability. */
export interface EmployeeResultSnapshot {
  employeeId: string;
  employeeName: string;
  department: string | null;
  position: string | null;
}

/** Actor of a generation run (snapshotted for audit readability). */
export interface AttendanceResultActor {
  id: string;
  name: string;
}

/**
 * The persisted canonical monthly attendance result.
 *
 * Extends the engine's MonthlyAttendanceResult verbatim (identity,
 * counters, deductions, compliance, daily breakdown) and adds ONLY
 * metadata. Attendance-domain deductions only — HR and Quality are
 * separate domains composed by report consumers, never merged here.
 */
export interface StoredAttendanceResult extends MonthlyAttendanceResult {
  /** Deterministic composite identity: `${month}_${employeeId}`. */
  id: string;
  schemaVersion: number;
  employeeSnapshot: EmployeeResultSnapshot;
  /** Resolved policy config frozen at generation time. */
  policySnapshot: AttendancePolicyConfig;
  /** Deterministic fingerprint of policySnapshot (see buildPolicyFingerprint). */
  policyFingerprint: string;
  /** Calculation-logic version marker (ATTENDANCE_ENGINE_VERSION). */
  engineVersion: string;
  /** ISO timestamp of the generation run that produced this record. */
  generatedAt: string;
  generatedBy: AttendanceResultActor;
}

/** Typed summary returned by a generation run (spec §12 shape). */
export interface AttendanceGenerationSummary {
  success: boolean;
  month: string;
  employeesProcessed: number;
  resultsCreated: number;
  resultsUpdated: number;
  failed: number;
  generatedAt: string;
  engineVersion: string;
}

/** Idempotent write plan: new records vs. deterministic replacements. */
export interface PlannedResultWrites {
  created: StoredAttendanceResult[];
  updated: { next: StoredAttendanceResult; previous: StoredAttendanceResult }[];
}

/** Raw operational inputs the adapter accepts (collection row shapes). */
export interface MonthlyRawInputs {
  employees: { id: string; name?: string | null; department?: string | null; position?: string | null; shiftStart?: string | null }[];
  biometrics: { employeeId?: string | null; date?: string | null; checkIn?: string | null; checkOut?: string | null }[];
  attendanceRecords: { employeeId?: string | null; date?: string | null; checkIn?: string | null; checkOut?: string | null; status?: string | null; minutesLate?: number | string | null; approvedRequestId?: string | null }[];
  requests: { id?: string; employeeId?: string | null; date?: string | null; type?: string | null; status?: string | null; reason?: string | null; createdAt?: string | null }[];
  waivers: { employeeId?: string | null; date?: string | null; deductionType?: string | null }[];
}

/**
 * Per-employee date-keyed engine input produced by the adapter.
 * `policy` and `asOf` are supplied by the orchestrator per run.
 */
export interface EmployeeMonthlyInput {
  employeeId: string;
  employeeName: string;
  department: string | null;
  position: string | null;
  shiftStart: string | null;
  biometricByDate?: Record<string, BiometricPairInput>;
  attendanceByDate?: Record<string, AttendanceRecordInput>;
  requestByDate?: Record<string, RequestInput>;
  waiversByDate?: Record<string, DeductionWaiverType[]>;
}

// ─────────────────────────────────────────────────────────────
//  PURE BUILDERS
// ─────────────────────────────────────────────────────────────

/**
 * Deterministic composite identity for one employee-month result.
 * Format: `${YYYY-MM}_${employeeId}` — cuid2 ids are alphanumeric,
 * so the underscore makes the split unambiguous. Regenerating the
 * same employee/month resolves to the SAME id (no duplicates).
 */
export function attendanceResultId(month: string, employeeId: string): string {
  return `${month}_${employeeId}`;
}

/** Deterministic JSON serialization: object keys sorted recursively. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** FNV-1a 32-bit hash → 8-char lowercase hex (deterministic, dependency-free). */
function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Deterministic fingerprint of the resolved policy configuration —
 * sufficient to answer "was this result generated under Policy
 * Configuration X?" without loading the full snapshot. The full
 * policySnapshot is stored alongside it for complete traceability.
 */
export function buildPolicyFingerprint(policy: AttendancePolicyConfig): string {
  return fnv1a32(stableStringify(policy));
}

/**
 * Adapter: index the raw operational collections into per-employee,
 * date-keyed engine inputs.
 *
 * Mirrors the report adapters' mapping EXACTLY (Milestone 2 §32):
 *   • malformed legacy dates can never match a calendar key and are
 *     dropped (identical to the pre-filter in both report routes);
 *   • requests: latest by createdAt wins per employee/date;
 *   • biometric/attendance: last record in array order wins per
 *     employee/date;
 *   • waivers: deductionType defaults to 'all' when absent.
 *
 * Contains no attendance RULES — evaluation stays in policy.ts.
 */
export function buildMonthlyInputIndex(raw: MonthlyRawInputs): Map<string, EmployeeMonthlyInput> {
  const index = new Map<string, EmployeeMonthlyInput>();
  const entryFor = (empId: string, emp?: MonthlyRawInputs['employees'][number]): EmployeeMonthlyInput => {
    let entry = index.get(empId);
    if (!entry) {
      entry = {
        employeeId: empId,
        employeeName: emp?.name || 'غير معروف',
        department: emp?.department || null,
        position: emp?.position || null,
        shiftStart: emp?.shiftStart || null,
      };
      index.set(empId, entry);
    }
    return entry;
  };

  for (const emp of raw.employees) {
    if (!emp?.id) continue;
    entryFor(emp.id, emp);
  }

  const bioByEmp = new Map<string, Map<string, BiometricPairInput>>();
  for (const b of raw.biometrics) {
    if (!b?.employeeId || !b.date || !isValidLegacyDate(b.date)) continue;
    if (!bioByEmp.has(b.employeeId)) bioByEmp.set(b.employeeId, new Map());
    bioByEmp.get(b.employeeId)!.set(b.date, {
      checkIn: b.checkIn ?? null,
      checkOut: b.checkOut ?? null,
    });
  }

  const attByEmp = new Map<string, Map<string, AttendanceRecordInput>>();
  for (const a of raw.attendanceRecords) {
    if (!a?.employeeId || !a.date || !isValidLegacyDate(a.date)) continue;
    if (!attByEmp.has(a.employeeId)) attByEmp.set(a.employeeId, new Map());
    attByEmp.get(a.employeeId)!.set(a.date, {
      checkIn: a.checkIn ?? null,
      checkOut: a.checkOut ?? null,
      status: typeof a.status === 'string' ? a.status : '',
      minutesLate: Number(a.minutesLate) || 0,
      approvedRequestId: a.approvedRequestId ?? null,
    });
  }

  const reqByEmpDate = new Map<string, Map<string, RequestInput>>();
  for (const r of raw.requests) {
    if (!r?.id || !r.employeeId || !r.date || !isValidLegacyDate(r.date)) continue;
    if (!reqByEmpDate.has(r.employeeId)) reqByEmpDate.set(r.employeeId, new Map());
    const dateMap = reqByEmpDate.get(r.employeeId)!;
    const existing = dateMap.get(r.date);
    if (!existing || new Date(r.createdAt || 0) > new Date(existing.createdAt || 0)) {
      dateMap.set(r.date, {
        id: r.id,
        type: r.type || '',
        status: (r.status || '') as RequestInput['status'],
        reason: r.reason ?? null,
        createdAt: r.createdAt ?? null,
      });
    }
  }

  const waivedByEmp = new Map<string, Map<string, DeductionWaiverType[]>>();
  for (const w of raw.waivers) {
    if (!w?.employeeId || !w.date || !isValidLegacyDate(w.date)) continue;
    if (!waivedByEmp.has(w.employeeId)) waivedByEmp.set(w.employeeId, new Map());
    const dateMap = waivedByEmp.get(w.employeeId)!;
    const types = dateMap.get(w.date) || [];
    types.push((w.deductionType || 'all') as DeductionWaiverType);
    dateMap.set(w.date, types);
  }

  for (const [empId, entry] of index) {
    const bio = bioByEmp.get(empId);
    const att = attByEmp.get(empId);
    const req = reqByEmpDate.get(empId);
    const waived = waivedByEmp.get(empId);
    if (bio && bio.size > 0) entry.biometricByDate = Object.fromEntries(bio);
    if (att && att.size > 0) entry.attendanceByDate = Object.fromEntries(att);
    if (req && req.size > 0) entry.requestByDate = Object.fromEntries(req);
    if (waived && waived.size > 0) entry.waiversByDate = Object.fromEntries(waived);
  }

  return index;
}

/**
 * Serialize a canonical engine result into its persisted shape.
 *
 * Pure transformation: engine output preserved verbatim (deep copy of
 * policy + daily so later config/object mutations can never mutate a
 * stored historical result), plus metadata only. No recalculation.
 */
export function buildStoredAttendanceResult(args: {
  result: MonthlyAttendanceResult;
  employeeSnapshot: EmployeeResultSnapshot;
  policy: AttendancePolicyConfig;
  actor: AttendanceResultActor;
  now: Date;
}): StoredAttendanceResult {
  const policySnapshot = JSON.parse(JSON.stringify(args.policy)) as AttendancePolicyConfig;
  return {
    ...args.result,
    id: attendanceResultId(args.result.month, args.result.employeeId),
    schemaVersion: ATTENDANCE_RESULT_SCHEMA_VERSION,
    employeeSnapshot: { ...args.employeeSnapshot },
    policySnapshot,
    policyFingerprint: buildPolicyFingerprint(args.policy),
    engineVersion: ATTENDANCE_ENGINE_VERSION,
    generatedAt: args.now.toISOString(),
    generatedBy: { ...args.actor },
  };
}

/**
 * Classify computed results against the existing records for the
 * month: same employeeId → deterministic replacement (update), new
 * employeeId → create. This is the idempotency decision — the write
 * layer persists exactly this plan.
 */
export function planResultWrites(
  existing: StoredAttendanceResult[],
  computed: StoredAttendanceResult[],
): PlannedResultWrites {
  const existingByEmployee = new Map(existing.map((rec) => [rec.employeeId, rec]));
  const plan: PlannedResultWrites = { created: [], updated: [] };
  for (const next of computed) {
    const previous = existingByEmployee.get(next.employeeId);
    if (previous) plan.updated.push({ next, previous });
    else plan.created.push(next);
  }
  return plan;
}

/** Compact before/after metadata embedded in audit entries (never the full daily array). */
export function buildResultAuditMetadata(
  result: StoredAttendanceResult,
): Record<string, unknown> {
  return {
    id: result.id,
    employeeId: result.employeeId,
    month: result.month,
    workDays: result.workDays,
    presentDays: result.presentDays,
    lateDays: result.lateDays,
    absentDays: result.absentDays,
    exemptDays: result.exemptDays,
    unaccountedDays: result.unaccountedDays,
    lateDeductionDays: result.lateDeductionDays,
    absenceDeductionDays: result.absenceDeductionDays,
    attendanceDeductionDays: result.attendanceDeductionDays,
    compliance: result.compliance,
    engineVersion: result.engineVersion,
    policyFingerprint: result.policyFingerprint,
    generatedAt: result.generatedAt,
    generatedBy: result.generatedBy.id,
  };
}

/**
 * Build the audit entries for one generation run (pure):
 *   • one month-level 'generate_month' entry anchoring the run;
 *   • one per-employee 'generate' (create) / 'regenerate' (replace)
 *     entry with previous/new result metadata.
 * Written to ATTENDANCE_AUDIT_LOG_TABLE via the existing generic
 * audit infrastructure — no new audit framework.
 */
export function buildGenerationAuditEntries(args: {
  monthKey: string;
  actor: AttendanceResultActor;
  plan: PlannedResultWrites;
  failed: number;
  policyFingerprint: string;
  generatedAt: string;
}): WriteAuditInput[] {
  const base = {
    collection: ATTENDANCE_AUDIT_LOG_TABLE,
    actorId: args.actor.id,
    actorName: args.actor.name,
    entityType: 'attendanceResult',
    monthKey: args.monthKey,
  };

  const entries: WriteAuditInput[] = [
    {
      ...base,
      entityType: 'attendanceMonth',
      action: 'generate_month',
      entityId: args.monthKey,
      before: null,
      after: {
        month: args.monthKey,
        employeesProcessed: args.plan.created.length + args.plan.updated.length + args.failed,
        resultsCreated: args.plan.created.length,
        resultsUpdated: args.plan.updated.length,
        failed: args.failed,
        engineVersion: ATTENDANCE_ENGINE_VERSION,
        policyFingerprint: args.policyFingerprint,
        generatedAt: args.generatedAt,
      },
      details: `توليد نتائج الحضور الشهرية لشهر ${args.monthKey} (${args.plan.created.length} جديد، ${args.plan.updated.length} محدّث)`,
    },
  ];

  for (const created of args.plan.created) {
    entries.push({
      ...base,
      action: 'generate',
      entityId: created.id,
      before: null,
      after: buildResultAuditMetadata(created),
      details: `توليد نتيجة حضور ${created.employeeSnapshot.employeeName} لشهر ${args.monthKey}`,
    });
  }

  for (const { next, previous } of args.plan.updated) {
    entries.push({
      ...base,
      action: 'regenerate',
      entityId: next.id,
      before: buildResultAuditMetadata(previous),
      after: buildResultAuditMetadata(next),
      details: `إعادة توليد نتيجة حضور ${next.employeeSnapshot.employeeName} لشهر ${args.monthKey}`,
    });
  }

  return entries;
}

// ─────────────────────────────────────────────────────────────
//  ORCHESTRATORS (wire builders to db.ts + the canonical engine)
// ─────────────────────────────────────────────────────────────

/**
 * Load the month's raw operational inputs (same loading pattern the
 * Milestone 2 report adapters use — batched, no N+1 employee reads).
 * Quality and HR deduction tables are intentionally NOT loaded: the
 * persisted attendance result carries attendance-domain values only.
 */
export async function loadMonthlyRawInputs(monthKey: string): Promise<MonthlyRawInputs> {
  const [yearStr, monStr] = monthKey.split('-');
  const datePattern = `/${monStr.padStart(2, '0')}/${yearStr}`;

  const [employees, biometrics, attendanceRecords, requests, waivers] = await Promise.all([
    getAll('employees') as Promise<MonthlyRawInputs['employees']>,
    findWhereContains('biometrics', 'date', datePattern),
    findWhereContains('attendance', 'date', datePattern),
    findWhereContains('requests', 'date', datePattern),
    findWhere('waivedDeductions', { month: monthKey }),
  ]);

  return { employees, biometrics, attendanceRecords, requests, waivers };
}

/**
 * Generate + persist the canonical monthly attendance results for
 * every employee of one month.
 *
 * Flow (spec §8): load raw inputs → resolve current policy → call
 * computeMonthlyAttendance() ONCE per employee → plan idempotent
 * writes → persist under deterministic ids → audit → invalidate the
 * attendanceResults cache → typed summary. Deterministic for fixed
 * inputs + policy + engine version; `asOf` is the server clock
 * (legacy current-month cutoff semantics — an explicit server-side
 * input, never client state).
 *
 * Concurrency note (same as closeMonth): RTDB exposes no CAS through
 * the db.ts helpers, so two simultaneous generations may both compute.
 * Both converge on the same deterministic ids — the worst case is one
 * redundant replace, never duplicate records.
 */
export async function generateMonthlyAttendanceResults(
  monthKey: string,
  actor: AttendanceResultActor,
): Promise<AttendanceGenerationSummary> {
  const [deductionRules, rawInputs, existingResults] = await Promise.all([
    getAll('deductionRules'),
    loadMonthlyRawInputs(monthKey),
    findWhere<StoredAttendanceResult>(ATTENDANCE_RESULTS_TABLE, { month: monthKey }),
  ]);

  const policy = resolveAttendancePolicy(deductionRules);
  const policyFingerprint = buildPolicyFingerprint(policy);
  const now = new Date();
  const generatedAt = now.toISOString();

  const computed: StoredAttendanceResult[] = [];
  const failures: unknown[] = [];

  const inputIndex = buildMonthlyInputIndex(rawInputs);
  for (const [employeeId, input] of inputIndex) {
    try {
      const result = computeMonthlyAttendance({
        employeeId,
        month: monthKey,
        shiftStart: input.shiftStart,
        asOf: now,
        policy,
        biometricByDate: input.biometricByDate,
        attendanceByDate: input.attendanceByDate,
        requestByDate: input.requestByDate,
        waiversByDate: input.waiversByDate,
      });
      computed.push(buildStoredAttendanceResult({
        result,
        employeeSnapshot: {
          employeeId,
          employeeName: input.employeeName,
          department: input.department,
          position: input.position,
        },
        policy,
        actor,
        now,
      }));
    } catch (error) {
      failures.push({ employeeId, error });
      console.error(JSON.stringify({
        level: 'error',
        module: 'attendance:monthly-results',
        op: 'generateMonthlyAttendanceResults',
        employeeId,
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  const plan = planResultWrites(existingResults, computed);

  for (const record of plan.created) {
    await createRecordWithId(ATTENDANCE_RESULTS_TABLE, record.id, record as unknown as Record<string, unknown>);
  }
  // Replace-merge under the same id preserves the original createdAt
  // (audit anchor for first generation) while updatedAt advances.
  for (const { next } of plan.updated) {
    await updateRecord(ATTENDANCE_RESULTS_TABLE, next.id, next as unknown as Record<string, unknown>);
  }
  invalidateCache(ATTENDANCE_RESULTS_TABLE);

  const summary: AttendanceGenerationSummary = {
    success: failures.length === 0,
    month: monthKey,
    employeesProcessed: computed.length + failures.length,
    resultsCreated: plan.created.length,
    resultsUpdated: plan.updated.length,
    failed: failures.length,
    generatedAt,
    engineVersion: ATTENDANCE_ENGINE_VERSION,
  };

  const auditEntries = buildGenerationAuditEntries({
    monthKey,
    actor,
    plan,
    failed: failures.length,
    policyFingerprint,
    generatedAt,
  });
  await Promise.all(auditEntries.map((entry) => writeAudit(entry)));

  return summary;
}

/**
 * Read the stored results for a month. READ-ONLY: never computes or
 * regenerates — a month that was never generated simply returns [].
 */
export async function getAttendanceResultsForMonth(monthKey: string): Promise<StoredAttendanceResult[]> {
  const all = await getAll<StoredAttendanceResult>(ATTENDANCE_RESULTS_TABLE, TTL.STATIC);
  return all.filter((r) => r.month === monthKey);
}

/**
 * Read one stored employee-month result by canonical identity.
 * READ-ONLY: returns null when the result was never generated —
 * callers surface an explicit not_generated state, never a live
 * recalculation.
 */
export async function getAttendanceResult(
  monthKey: string,
  employeeId: string,
): Promise<StoredAttendanceResult | null> {
  return getById<StoredAttendanceResult>(ATTENDANCE_RESULTS_TABLE, attendanceResultId(monthKey, employeeId));
}
