// ══════════════════════════════════════════════════════════════
//  Employee Performance Hub — Unified Timeline (§11)
//
//  An ANALYTICAL INDEX over the period's canonical records — never a
//  second database. Every event points at the record's OWNING page
//  through navigateTo(page, highlightId, navParams); the record
//  itself is never duplicated.
//
//  PURE: consumes the already-attributed period records (the same
//  canonical loaders/attribution the dataset uses) + the gated HR
//  records, and emits deterministic, chronologically sorted events.
// ══════════════════════════════════════════════════════════════

import type { StoredAttendanceResult } from '@/lib/attendance';
import type { CAPACase, CustomerComplaint, FollowUp, QualityDeduction, TravelDeal } from '@/types';
import type { QualityObservation } from '@/types/quality-kpi';
import type { EmployeeHrDeductionRecord } from '@/lib/employee-performance';
import type { HubTimelineEvent } from './types';

/** Cap on rendered events (the timeline stays an index, not a dump). */
export const MAX_TIMELINE_EVENTS = 100;

/** Day key (YYYY-MM-DD) from an ISO timestamp or DD/MM/YYYY display date. */
function dayKeyOfValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.includes('/')) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(value);
    if (m) {
      const dd = m[1].padStart(2, '0');
      const mm = m[2].padStart(2, '0');
      return `${m[3]}-${mm}-${dd}`;
    }
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function pushEvent(out: HubTimelineEvent[], event: HubTimelineEvent): void {
  if (out.some((e) => e.id === event.id)) return; // deterministic dedupe
  out.push(event);
}

/**
 * Build the unified timeline. Records must already be narrowed to the
 * reported period by the caller's canonical attribution.
 */
export function buildHubTimeline(records: {
  observations: ReadonlyArray<QualityObservation>;
  qualityDeductions: ReadonlyArray<QualityDeduction>;
  followUps: ReadonlyArray<FollowUp>;
  complaints: ReadonlyArray<CustomerComplaint>;
  capaCases: ReadonlyArray<CAPACase>;
  deals: ReadonlyArray<TravelDeal>;
  attendanceResult: StoredAttendanceResult | null;
  /** HR records for the period (empty when restricted). */
  hrRecords: ReadonlyArray<EmployeeHrDeductionRecord & { id?: string; type?: string; deductionDate?: string | null; status?: string | null }>;
  /** The KPI result marker (valueBasis/finalized) for the period. */
  kpi: { monthKey: string; finalized: boolean; rowStatus: string } | null;
}): HubTimelineEvent[] {
  const out: HubTimelineEvent[] = [];

  // ── Quality observations ──
  for (const o of records.observations) {
    const day = dayKeyOfValue(o.observationDate);
    if (!day) continue;
    pushEvent(out, {
      id: `quality:${o.id}`,
      sortKey: day,
      displayDate: o.observationDate,
      domain: 'quality',
      eventType: 'observation',
      title: o.categoryName || o.type || '',
      severity: o.severity ?? null,
      status: o.approvalStatus ?? o.status ?? null,
      source: { page: 'observations', highlightId: o.id, navParams: { month: o.month || day.slice(0, 7) } },
    });
  }

  // ── Quality deductions (separate domain — never merged into observations) ──
  for (const d of records.qualityDeductions) {
    const day = dayKeyOfValue(d.date);
    if (!day) continue;
    pushEvent(out, {
      id: `qualityDeduction:${d.id}`,
      sortKey: day,
      displayDate: d.date,
      domain: 'quality',
      eventType: 'qualityDeduction',
      title: d.type || d.description || '',
      severity: null,
      status: null,
      source: { page: 'quality', highlightId: d.id, navParams: { month: d.month || day.slice(0, 7) } },
    });
  }

  // ── Follow-ups ──
  for (const f of records.followUps) {
    const day = dayKeyOfValue(f.date);
    if (!day) continue;
    pushEvent(out, {
      id: `followUp:${f.id}`,
      sortKey: day,
      displayDate: f.date,
      domain: 'followUp',
      eventType: 'followUp',
      title: f.subject || f.followUpType || '',
      severity: f.priorityLevel ?? null,
      status: f.status ?? null,
      source: { page: 'followUps', highlightId: f.id, navParams: {} },
    });
  }

  // ── Complaints ──
  for (const c of records.complaints) {
    const day = dayKeyOfValue(c.createdAt);
    if (!day) continue;
    pushEvent(out, {
      id: `complaint:${c.id}`,
      sortKey: day,
      displayDate: day,
      domain: 'complaints',
      eventType: 'complaint',
      title: c.complaintType || '',
      severity: c.severity ?? null,
      status: c.status ?? null,
      source: { page: 'complaints', highlightId: c.id, navParams: {} },
    });
  }

  // ── CAPA ──
  for (const c of records.capaCases) {
    const day = dayKeyOfValue(c.createdAt);
    if (!day) continue;
    pushEvent(out, {
      id: `capa:${c.id}`,
      sortKey: day,
      displayDate: day,
      domain: 'capa',
      eventType: 'capa',
      title: c.title || c.capaId || '',
      severity: c.priority ?? null,
      status: c.status ?? null,
      source: { page: 'capa', highlightId: c.id, navParams: {} },
    });
  }

  // ── Deals — DEAL_CLOSED dimension only (تاريخ تقفيل الديل); the
  //    closure moment is the canonical business event for the timeline.
  //    An unknown closure date is never replaced by another date. ──
  for (const d of records.deals) {
    const closedAt = typeof d.dealClosedAt === 'string' ? d.dealClosedAt : null;
    if (!closedAt) continue; // unknown closure moment is never replaced by another date
    const day = dayKeyOfValue(closedAt);
    if (!day) continue;
    pushEvent(out, {
      id: `deal:${d.id}`,
      sortKey: day,
      displayDate: closedAt,
      domain: 'deals',
      eventType: 'dealClosed',
      title: d.destination || d.customerNames || d.id,
      severity: null,
      status: d.status ?? null,
      source: { page: 'travel', highlightId: d.id, navParams: {} },
    });
  }

  // ── Attendance — the stored monthly result as ONE month marker ──
  if (records.attendanceResult) {
    const month = records.attendanceResult.month;
    pushEvent(out, {
      id: `attendance:${records.attendanceResult.id ?? month}`,
      sortKey: `${month}-01`,
      displayDate: month,
      domain: 'attendance',
      eventType: 'attendanceResult',
      title: '',
      severity: null,
      status: null,
      source: { page: 'attendance', highlightId: null, navParams: { month } },
    });
  }

  // ── HR deductions (only included when the caller is authorized) ──
  for (const h of records.hrRecords) {
    const day = dayKeyOfValue(h.deductionDate ?? null) ?? (h.month ? `${h.month}-01` : null);
    if (!day) continue;
    pushEvent(out, {
      id: `hr:${h.id ?? `${h.month ?? 'unknown'}:${h.type ?? ''}`}`,
      sortKey: day,
      displayDate: h.deductionDate ?? h.month ?? day,
      domain: 'hr',
      eventType: 'hrDeduction',
      title: h.type || '',
      severity: null,
      status: h.status ?? null,
      source: { page: 'hrDeductions', highlightId: h.id ?? null, navParams: { month: h.month || day.slice(0, 7) } },
    });
  }

  // ── KPI result marker ──
  if (records.kpi) {
    pushEvent(out, {
      id: `kpi:${records.kpi.monthKey}`,
      sortKey: `${records.kpi.monthKey}-01`,
      displayDate: records.kpi.monthKey,
      domain: 'kpi',
      eventType: 'kpiResult',
      title: '',
      severity: null,
      status: records.kpi.rowStatus,
      source: { page: 'kpiReports', highlightId: null, navParams: { month: records.kpi.monthKey } },
    });
  }

  // Deterministic order: newest first, then id for stable ties.
  out.sort((a, b) => b.sortKey.localeCompare(a.sortKey) || a.id.localeCompare(b.id));
  return out.slice(0, MAX_TIMELINE_EVENTS);
}
