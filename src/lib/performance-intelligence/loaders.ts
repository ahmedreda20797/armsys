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
import { isEffectiveDeduction } from '@/lib/quality-deductions/domain';
import { attributeMonth, monthKeyOfDisplayDate, monthKeyOfStoredMonth } from './month-attribution';
import { getDealMonthKey } from '@/lib/deal-dates';

/** The RTDB org-tree collection (literal parity with lib/organization). */
export const ORG_NODES_TABLE = 'orgNodes';

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
  /** Org-tree assignment — the anchor for team/department resolution. */
  orgNodeId: string | null;
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
  /** Org-tree nodes for team/department label resolution (org tree is authoritative). */
  loadOrgNodes(): Promise<Array<{ id: string; name: string; type: string; parentId: string | null; status?: string | null }>>;
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
    orgNodeId: typeof raw.orgNodeId === 'string' && raw.orgNodeId.length > 0 ? raw.orgNodeId : null,
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

  loadOrgNodes: async () => {
    const nodes = await getAll<Record<string, unknown>>(ORG_NODES_TABLE, TTL.MEDIUM);
    return nodes
      .filter((n) => n && typeof n.id === 'string')
      .map((n) => ({
        id: n.id as string,
        name: String(n.name ?? ''),
        type: String(n.type ?? ''),
        parentId: typeof n.parentId === 'string' ? n.parentId : null,
        status: typeof n.status === 'string' ? n.status : null,
      }));
  },

  loadObservationsForWindow: async (employeeId, months) => {
    const monthSet = new Set(months);
    const all = await getAll<QualityObservation>(PERFORMANCE_INTELLIGENCE_SOURCES.observations, TTL.MEDIUM);
    // ROOT-CAUSE FIX (Smart Quality Report "غير متاح"): records with a
    // missing/legacy-shaped `month` are attributed through the SAME
    // canonical policy as the assembler (attributeMonth: stored month →
    // display date → ISO) — never a second policy, never dropped while
    // a valid date exists. Records that still cannot be attributed fall
    // through to the assembler's unattributed accounting.
    return all.filter((o) => {
      if (!o || o.employeeId !== employeeId) return false;
      const month = attributeMonth(o.month, o.observationDate);
      return month !== null && monthSet.has(month);
    });
  },

  loadQualityDeductions: async (employeeId) => {
    const all = await getAll<QualityDeduction>(PERFORMANCE_INTELLIGENCE_SOURCES.deductions);
    // §WORKFLOW — pending/rejected discounts never reach the
    // performance-intelligence dataset (Smart Report / تحليل الأداء).
    return all.filter((r) => r && r.employeeId === employeeId && isEffectiveDeduction(r));
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

/** Observation attribution — the CANONICAL attributeMonth policy:
 *  stored `month` → observationDate (DD/MM/YYYY) → ISO date. Legacy
 *  records whose observationDate was stored ISO-shaped used to fall
 *  through the display-date-only parse into `unattributed` and vanish
 *  from the report — attributeMonth is the existing single policy. */
export function monthOfObservation(obs: QualityObservation): string | null {
  return attributeMonth(obs.month, obs.observationDate);
}

/** Quality deduction attribution — same canonical policy
 *  (stored month → DD/MM/YYYY date → ISO). */
export function monthOfQualityDeduction(record: QualityDeduction): string | null {
  return attributeMonth(record.month, record.date);
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

// ── §DEAL-DATES — deal attribution is DIMENSION-EXPLICIT ──
// Every deal metric declares which canonical date it is counted by;
// a missing date in one dimension is UNKNOWN (unattributed) and is
// never replaced by another dimension's date.

/** Deal TRAVEL attribution — the customer's departure month (TRAVEL dimension). */
export function monthOfDealTravel(record: TravelDeal): string | null {
  return getDealMonthKey(record, 'TRAVEL');
}

/** Deal CLOSED attribution — the observed closure month (CLOSED dimension,
 *  closedAt). Null when the closure moment is unknown — never fabricated. */
export function monthOfDealClosed(record: TravelDeal): string | null {
  return getDealMonthKey(record, 'CLOSED');
}

/** Deal CREATED attribution — record-creation month (CREATED dimension, intake). */
export function monthOfDealCreated(record: TravelDeal): string | null {
  return getDealMonthKey(record, 'CREATED');
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
