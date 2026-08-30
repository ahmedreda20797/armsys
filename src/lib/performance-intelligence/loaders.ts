// ══════════════════════════════════════════════════════════════
//  Employee Performance Intelligence — Data Loaders (Phase 3)
//
//  Project convention: business builders are PURE and every db-bound
//  orchestration accepts in-memory loaders in tests (no Firebase
//  mocking).
//
//  The loaders EXTEND the KPI Reporting loader set so the canonical
//  Employee KPI report (and through it the Phase-1 engine pipeline)
//  can run with the SAME object — zero engine duplication.
//
//  Batched reads only (spec §21): ONE cached collection read per
//  table per request, filtered in memory — no N+1 loops.
//
//  READ-ONLY (spec §22): only getAll/getById-style readers are used;
//  no create/update/delete path exists in this module.
// ══════════════════════════════════════════════════════════════

import { getAll, getById, TTL } from '@/lib/db';
import { ATTENDANCE_RESULTS_TABLE } from '@/lib/attendance';
import type { StoredAttendanceResult } from '@/lib/attendance';
import type { CAPACase, CustomerComplaint, FollowUp, QualityDeduction, TravelDeal } from '@/types';
import type { QualityObservation } from '@/types/quality-kpi';
import type { KpiReportingLoaders } from '@/lib/kpi-reporting';
import { defaultKpiReportingLoaders } from '@/lib/kpi-reporting';
import { monthKeyOfDisplayDate, monthKeyOfStoredMonth } from './month-attribution';

/** Existing collections consumed read-only (literal parity with the owning routes). */
export const PERFORMANCE_INTELLIGENCE_SOURCES = {
  observations: 'qualityObservations',
  deductions: 'qualityDeductions',
  complaints: 'complaints',
  capa: 'capaCases',
  followUps: 'followUps',
  deals: 'travelDeals',
  attendance: ATTENDANCE_RESULTS_TABLE,
} as const;

/** The employee fields the identity facts read (stable fields + lifecycle stamps). */
export interface EmployeeIdentityRecord {
  id: string;
  name: string;
  code: string | null;
  department: string | null;
  position: string | null;
  status: unknown;
  archivedAt: string | null;
  restoredAt: string | null;
}

/** CAPA cases split by their ACTUAL relationship to the employee. */
export interface CapaRelationshipSplit {
  /** capaCases.employeeId === employeeId. */
  primary: CAPACase[];
  /** employeeId in capaCases.relatedEmployeeIds (but not the primary link). */
  indirect: CAPACase[];
}

export interface PerformanceIntelligenceLoaders extends KpiReportingLoaders {
  /** Raw employee record incl. lifecycle stamps (null = not found). */
  loadEmployeeIdentity(employeeId: string): Promise<EmployeeIdentityRecord | null>;
  /** One collection read for the whole analysis window, filtered in memory. */
  loadObservationsForWindow(employeeId: string, months: ReadonlyArray<string>): Promise<QualityObservation[]>;
  loadQualityDeductions(employeeId: string): Promise<QualityDeduction[]>;
  loadComplaints(employeeId: string): Promise<CustomerComplaint[]>;
  loadCapaCases(employeeId: string): Promise<CapaRelationshipSplit>;
  loadFollowUps(employeeId: string): Promise<FollowUp[]>;
  loadTravelDeals(employeeId: string): Promise<TravelDeal[]>;
  /** The STORED monthly result for the employee/month (null when absent). */
  loadStoredAttendanceResult(employeeId: string, monthKey: string): Promise<StoredAttendanceResult | null>;
}

function toIdentityRecord(raw: Record<string, unknown>, id: string): EmployeeIdentityRecord {
  return {
    id,
    name: String(raw.name ?? ''),
    code: typeof raw.code === 'string' && raw.code.length > 0 ? raw.code : null,
    department: typeof raw.department === 'string' ? raw.department : null,
    position: typeof raw.position === 'string' ? raw.position : null,
    status: raw.status,
    archivedAt: typeof raw.archivedAt === 'string' ? raw.archivedAt : null,
    restoredAt: typeof raw.restoredAt === 'string' ? raw.restoredAt : null,
  };
}

/** DB-backed default loader set (all reads cached by lib/db — READ-ONLY). */
export const defaultPerformanceIntelligenceLoaders: PerformanceIntelligenceLoaders = {
  // Canonical reporting/engine loaders reused verbatim.
  ...defaultKpiReportingLoaders,

  loadEmployeeIdentity: async (employeeId) => {
    const raw = await getById<Record<string, unknown>>('employees', employeeId);
    return raw ? toIdentityRecord(raw, employeeId) : null;
  },

  loadObservationsForWindow: async (employeeId, months) => {
    const monthSet = new Set(months);
    const all = await getAll<QualityObservation>(PERFORMANCE_INTELLIGENCE_SOURCES.observations, TTL.MEDIUM);
    return all.filter((o) => o && o.employeeId === employeeId && monthSet.has(o.month));
  },

  loadQualityDeductions: async (employeeId) => {
    const all = await getAll<QualityDeduction>(PERFORMANCE_INTELLIGENCE_SOURCES.deductions);
    return all.filter((r) => r && r.employeeId === employeeId);
  },

  loadComplaints: async (employeeId) => {
    const all = await getAll<CustomerComplaint>(PERFORMANCE_INTELLIGENCE_SOURCES.complaints);
    // Only the DIRECT stored link attributes a complaint — never invented.
    return all.filter((c) => c && c.employeeId === employeeId);
  },

  loadCapaCases: async (employeeId) => {
    const all = await getAll<CAPACase>(PERFORMANCE_INTELLIGENCE_SOURCES.capa);
    const primary: CAPACase[] = [];
    const indirect: CAPACase[] = [];
    for (const capa of all) {
      if (!capa) continue;
      if (capa.employeeId === employeeId) primary.push(capa);
      else if (Array.isArray(capa.relatedEmployeeIds) && capa.relatedEmployeeIds.includes(employeeId)) indirect.push(capa);
    }
    return { primary, indirect };
  },

  loadFollowUps: async (employeeId) => {
    const all = await getAll<FollowUp>(PERFORMANCE_INTELLIGENCE_SOURCES.followUps);
    return all.filter((f) => f && f.employeeId === employeeId);
  },

  loadTravelDeals: async (employeeId) => {
    const all = await getAll<TravelDeal>(PERFORMANCE_INTELLIGENCE_SOURCES.deals);
    return all.filter((d) => d && d.employeeId === employeeId);
  },

  loadStoredAttendanceResult: async (employeeId, monthKey) => {
    const all = await getAll<StoredAttendanceResult>(PERFORMANCE_INTELLIGENCE_SOURCES.attendance, TTL.STATIC);
    // Last-wins per (employee, month) — parity with the established
    // attendanceResults regeneration semantics.
    let found: StoredAttendanceResult | null = null;
    for (const record of all) {
      if (record && record.employeeId === employeeId && record.month === monthKey) found = record;
    }
    return found;
  },
};

// ─────────────────────────────────────────────────────────────
//  Shared pure helpers over loaded data (period attribution)
// ─────────────────────────────────────────────────────────────

export interface AttributedRecords<T> {
  /** Records whose attributed month IS the reported period. */
  inPeriod: T[];
  /** Records inside the analysis window (period included). */
  inWindow: T[];
  /** window month → records (only months with data). */
  byMonth: Map<string, T[]>;
  /** Records whose month could not be attributed deterministically. */
  unattributed: number;
}

/**
 * Deterministic period attribution over already-loaded records.
 * A record without a derivable month is counted as unattributed —
 * never guessed into a bucket (spec §19).
 */
export function attributeRecords<T>(
  records: ReadonlyArray<T>,
  monthOf: (record: T) => string | null,
  period: string,
  windowMonths: ReadonlyArray<string>,
): AttributedRecords<T> {
  const windowSet = new Set(windowMonths);
  const out: AttributedRecords<T> = { inPeriod: [], inWindow: [], byMonth: new Map(), unattributed: 0 };
  for (const record of records) {
    const month = monthOf(record);
    if (!month) {
      out.unattributed += 1;
      continue;
    }
    if (month === period) out.inPeriod.push(record);
    if (windowSet.has(month)) {
      out.inWindow.push(record);
      const list = out.byMonth.get(month) ?? [];
      list.push(record);
      out.byMonth.set(month, list);
    }
  }
  return out;
}

/** Observation attribution — the stored `month` field is mandatory in the model. */
export function monthOfObservation(obs: QualityObservation): string | null {
  return monthKeyOfStoredMonth(obs.month);
}

/** Quality deduction attribution — stored `month` field, display-date fallback. */
export function monthOfQualityDeduction(record: QualityDeduction): string | null {
  return monthKeyOfStoredMonth(record.month) ?? monthKeyOfDisplayDate(record.date);
}

/** Complaint attribution — creation timestamp (the record's only business date). */
export function monthOfComplaint(record: CustomerComplaint): string | null {
  return monthOfIsoOrDisplay(record.createdAt);
}

/** CAPA attribution — creation timestamp (due dates are deadlines, not occurrence). */
export function monthOfCapa(record: CAPACase): string | null {
  return monthOfIsoOrDisplay(record.createdAt);
}

/** Follow-up attribution — the follow-up `date` (DD/MM/YYYY), createdAt fallback. */
export function monthOfFollowUp(record: FollowUp): string | null {
  return monthKeyOfDisplayDate(record.date) ?? monthOfIsoOrDisplay(record.createdAt);
}

/** Deal attribution — departure date (DD/MM/YYYY), createdAt fallback. */
export function monthOfTravelDeal(record: TravelDeal): string | null {
  return monthKeyOfDisplayDate(record.departureDate) ?? monthOfIsoOrDisplay(record.createdAt);
}

function monthOfIsoOrDisplay(value: string): string | null {
  if (typeof value !== 'string') return null;
  if (value.includes('/')) return monthKeyOfDisplayDate(value);
  return isoMonthKey(value);
}

function isoMonthKey(value: string): string | null {
  if (!/^\d{4}-\d{2}/.test(value)) return null;
  const candidate = value.slice(0, 7);
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(candidate) ? candidate : null;
}
