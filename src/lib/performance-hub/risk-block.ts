// ══════════════════════════════════════════════════════════════
//  Employee Performance Hub — period-scoped RISK block
//
//  The Hub does NOT own a risk formula: the canonical engine
//  (lib/metrics computeRisk) is THE single calculation. This module
//  only derives the canonical RiskInput counts from the employee's
//  PERIOD records — the same counting rules the Risk Center applies
//  in its month-attributed mode (risk-center/route.ts §14):
//    • delays/absences → the STORED monthly attendance result
//      (canonical attendance engine output — never raw punches)
//    • quality → EFFECTIVE quality deductions (§WORKFLOW gate)
//    • hr → HR deduction records (only when the viewer is authorized)
//    • follow-ups → canonical isActiveFollowUp + priority counts
//    • repeated → same follow-up type occurring ≥2 times WITHIN the
//      period (the period-scoped reading of the "same type within 30
//      days" rule — occurrences inside one month are inside 30 days)
//    • complaints → canonical isOpenComplaintStatus
//    • CAPA → canonical isTerminalCAPA / isOverdueCAPA / priority
//
//  PURE: no reads, no writes. Tests inject records directly.
// ══════════════════════════════════════════════════════════════

import type { StoredAttendanceResult } from '@/lib/attendance';
import type { CAPACase, CustomerComplaint, FollowUp } from '@/types';
import {
  computeRisk,
  isOverdueCAPA,
  isTerminalCAPA,
  isActiveFollowUp,
  type RiskBreakdown,
  type RiskResult,
} from '@/lib/metrics';
import { isOpenComplaintStatus } from '@/lib/complaints/complaint-status';

/** Records contributing to ONE period's canonical risk counts. */
export interface HubPeriodRiskRecords {
  /** The stored monthly attendance result (null = not generated). */
  attendanceResult: StoredAttendanceResult | null;
  /** EFFECTIVE quality deductions attributed to the period. */
  qualityDeductionCount: number;
  /** HR deduction records attributed to the period (0 when restricted). */
  hrCount: number;
  followUps: ReadonlyArray<FollowUp>;
  complaints: ReadonlyArray<CustomerComplaint>;
  /** CAPA cases linked to the employee (primary + indirect). */
  capaCases: ReadonlyArray<CAPACase>;
  now: Date;
}

/** Canonical breakdown factor keys that carry points (the signal list). */
export function riskSignalsOf(breakdown: RiskBreakdown): Array<{ factor: string; count: number; points: number }> {
  return (Object.entries(breakdown) as Array<[string, { count: number; points: number }]>)
    .filter(([, entry]) => entry.points > 0)
    .map(([factor, entry]) => ({ factor, count: entry.count, points: entry.points }));
}

/**
 * The canonical risk result for ONE period. The formula is
 * computeRisk — this function only supplies its counts.
 */
export function computePeriodRisk(records: HubPeriodRiskRecords): RiskResult {
  // ── Follow-up counts (canonical predicates) ──
  let openFollowUpCount = 0;
  let highPriorityFollowUpCount = 0;
  let criticalFollowUpCount = 0;
  const typeOccurrences = new Map<string, number>();
  for (const f of records.followUps) {
    if (isActiveFollowUp(f)) openFollowUpCount += 1;
    if (f.priorityLevel === 'high') highPriorityFollowUpCount += 1;
    if (f.priorityLevel === 'critical') criticalFollowUpCount += 1;
    const typeKey = typeof f.followUpType === 'string' ? f.followUpType : '';
    if (typeKey) typeOccurrences.set(typeKey, (typeOccurrences.get(typeKey) ?? 0) + 1);
  }
  // Repeated: types occurring ≥2 times within the period.
  let repeatedIssueCount = 0;
  for (const count of typeOccurrences.values()) {
    if (count >= 2) repeatedIssueCount += 1;
  }

  // ── Complaints (canonical open predicate; direct link only) ──
  let openComplaintCount = 0;
  for (const c of records.complaints) {
    if (c.employeeId && isOpenComplaintStatus(c.status)) openComplaintCount += 1;
  }

  // ── CAPA (canonical terminal/overdue rules — Risk Center parity) ──
  let openCapaCount = 0;
  let overdueCapaCount = 0;
  let criticalCapaCount = 0;
  let reopenedCapaCount = 0;
  for (const c of records.capaCases) {
    if (isTerminalCAPA(c)) continue;
    openCapaCount += 1;
    if (isOverdueCAPA(c, records.now)) overdueCapaCount += 1;
    if (c.priority === 'critical') criticalCapaCount += 1;
    if (c.status === 'reopened') reopenedCapaCount += 1;
  }

  return computeRisk({
    // Stored attendance result — the canonical engine's own counters.
    delayCount: records.attendanceResult?.lateDays ?? 0,
    absenceCount: records.attendanceResult?.absentDays ?? 0,
    qualityCount: records.qualityDeductionCount,
    hrCount: records.hrCount,
    openFollowUpCount,
    highPriorityFollowUpCount,
    criticalFollowUpCount,
    openComplaintCount,
    repeatedIssueCount,
    openCapaCount,
    overdueCapaCount,
    criticalCapaCount,
    reopenedCapaCount,
  });
}
