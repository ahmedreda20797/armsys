// ══════════════════════════════════════════════════════════════
//  Employee Performance Intelligence — Dataset Assembler (Phase 3)
//
//  PURE: combines ALREADY-LOADED canonical data into the
//  employee-period analytical dataset. Reads nothing, writes
//  nothing, recalculates nothing — every value is a projection of
//  an input record (or the canonical KPI report passed in).
// ══════════════════════════════════════════════════════════════

import type { StoredAttendanceResult } from '@/lib/attendance';
import type { CAPACase, CustomerComplaint, FollowUp, QualityDeduction, TravelDeal } from '@/types';
import type { QualityObservation } from '@/types/quality-kpi';
import type { EmployeeKpiReport } from '@/lib/kpi-reporting';
import { normalizeEmployeeStatus } from '@/lib/organization/employee-status';
import type { EmployeeIdentityRecord } from './loaders';
import { attributeRecords, monthOfCapa, monthOfComplaint, monthOfFollowUp, monthOfObservation, monthOfQualityDeduction, monthOfTravelDeal } from './loaders';
import { buildAttendanceContext } from './attendance-context';
import { buildKpiFacts, buildScoreTrendFacts } from './kpi-facts';
import {
  aggregateObservations,
  aggregateQualityDeductions,
  countByMonth,
  detectRepeatedIssues,
  detectWindowRecurrence,
  DEFAULT_MIN_OCCURRENCES,
} from './quality-analysis';
import { aggregateCapaCases, aggregateComplaints, aggregateFollowUps, aggregateTravelDeals } from './operations-analysis';
import type {
  EmployeeIdentityFacts,
  EmployeePerformanceDataset,
  EvidenceGraph,
  PerformanceDataQuality,
} from './types';

export interface AssembleEmployeePerformanceDatasetInput {
  employeeId: string;
  monthKey: string;
  now: Date;
  windowMonths: ReadonlyArray<string>;
  minOccurrences?: number;
  /** Loaded canonical inputs (service or tests provide these). */
  identity: EmployeeIdentityRecord | null;
  kpiReport: EmployeeKpiReport;
  observations: ReadonlyArray<QualityObservation>;
  deductions: ReadonlyArray<QualityDeduction>;
  complaints: ReadonlyArray<CustomerComplaint>;
  capaSplit: { primary: ReadonlyArray<CAPACase>; indirect: ReadonlyArray<CAPACase> };
  followUps: ReadonlyArray<FollowUp>;
  deals: ReadonlyArray<TravelDeal>;
  attendanceResult: StoredAttendanceResult | null;
}

/**
 * Build the employee identity facts. Eligibility is the canonical
 * engine's verdict (no second lifecycle implementation); lifecycle
 * stamps are read verbatim from the stored record.
 */
function buildIdentityFacts(args: {
  employeeId: string;
  identity: EmployeeIdentityRecord | null;
  kpiReport: EmployeeKpiReport;
}): EmployeeIdentityFacts {
  const { employeeId, identity, kpiReport } = args;
  const eligible =
    kpiReport.outcomeStatus !== 'NOT_ELIGIBLE_PERIOD' && kpiReport.outcomeStatus !== 'EMPLOYEE_NOT_FOUND';

  if (!identity) {
    return {
      employeeId,
      employeeName: kpiReport.employee.employeeName,
      employeeCode: kpiReport.employee.employeeCode,
      department: kpiReport.employee.department,
      position: kpiReport.employee.position,
      employmentStatus: 'unknown',
      eligibleForPeriod: eligible,
      archivedButEligible: false,
      archivedAt: null,
      restoredAt: null,
      relationship: 'NOT_AVAILABLE',
    };
  }

  // Restored employees keep their archivedAt stamp — the record's
  // status field (normalized through the existing helper) is the
  // current lifecycle truth.
  const status = normalizeEmployeeStatus(identity.status);
  return {
    employeeId,
    employeeName: identity.name,
    employeeCode: identity.code,
    department: identity.department,
    position: identity.position,
    employmentStatus: status,
    eligibleForPeriod: eligible,
    archivedButEligible: status === 'archived' && eligible,
    archivedAt: identity.archivedAt,
    restoredAt: identity.restoredAt,
    relationship: 'CONFIRMED',
  };
}

function buildDataQuality(args: {
  windowMonths: ReadonlyArray<string>;
  unattributed: Array<{ collection: string; count: number }>;
}): PerformanceDataQuality {
  const notes: string[] = [];
  const { unattributed } = args;
  if (unattributed.some((u) => u.collection === 'followUps')) {
    notes.push('المتابعات: سجلات بلا تاريخ صالح تم استثناؤها من تحليل الفترة (لم تُنسب لشهر تخمينيًا).');
  }
  if (unattributed.some((u) => u.collection === 'travelDeals')) {
    notes.push('صفقات السفر: سجلات بلا تاريخ مغادرة صالح تم استثناؤها من تحليل الفترة.');
  }
  if (unattributed.some((u) => u.collection === 'complaints')) {
    notes.push('الشكاوى: سجلات بلا طابع زمني صالح تم استثناؤها من تحليل الفترة.');
  }
  if (unattributed.some((u) => u.collection === 'capaCases')) {
    notes.push('إجراءات CAPA: سجلات بلا طابع زمني صالح تم استثناؤها من تحليل الفترة.');
  }
  notes.push('لا يُشتق أي تأخير إنجاز للمتابعات: لا يوجد طابع زمني لإكمال المتابعة في نموذج البيانات.');
  notes.push('لا توجد حقول زمن استجابة في نموذج صفقات السفر — لا تُخترع مؤشرات مبيعات.');
  return {
    windowMonths: [...args.windowMonths],
    unattributedRecords: unattributed.filter((u) => u.count > 0),
    notes,
  };
}

function buildEvidenceGraph(args: {
  monthKey: string;
  kpiReport: EmployeeKpiReport;
  observations: ReadonlyArray<QualityObservation>;
  deductions: ReadonlyArray<QualityDeduction>;
  complaints: ReadonlyArray<CustomerComplaint>;
  capaCases: ReadonlyArray<CAPACase>;
  followUps: ReadonlyArray<FollowUp>;
  deals: ReadonlyArray<TravelDeal>;
  attendanceResult: StoredAttendanceResult | null;
}): EvidenceGraph {
  const ids = <T extends { id: string }>(records: ReadonlyArray<T>): string[] =>
    records.map((r) => r.id).sort((a, b) => a.localeCompare(b));

  const kpi: EvidenceGraph['kpi'] = [
    { collection: 'monthSnapshots', recordIds: [args.monthKey] },
  ];
  if (args.kpiReport.scheme?.schemeId) {
    kpi.push({ collection: 'kpiSchemes', recordIds: [args.kpiReport.scheme.schemeId] });
  }

  return {
    kpi,
    observations: { collection: 'qualityObservations', recordIds: ids(args.observations) },
    deductions: { collection: 'qualityDeductions', recordIds: ids(args.deductions) },
    complaints: { collection: 'complaints', recordIds: ids(args.complaints) },
    capa: { collection: 'capaCases', recordIds: ids(args.capaCases) },
    followUps: { collection: 'followUps', recordIds: ids(args.followUps) },
    deals: { collection: 'travelDeals', recordIds: ids(args.deals) },
    attendance: args.attendanceResult
      ? { collection: 'attendanceResults', recordIds: [`${args.attendanceResult.month}_${args.attendanceResult.employeeId}`] }
      : null,
  };
}

/**
 * Assemble the full dataset. All aggregates run over records already
 * narrowed to the employee by the loaders; the period/window split
 * is applied here deterministically.
 */
export function assembleEmployeePerformanceDataset(
  input: AssembleEmployeePerformanceDatasetInput,
): EmployeePerformanceDataset {
  const { employeeId, monthKey, now, windowMonths } = input;
  const minOccurrences = input.minOccurrences ?? DEFAULT_MIN_OCCURRENCES;

  // ── KPI + trend: canonical report projection (verbatim) ──
  const kpi = buildKpiFacts(input.kpiReport);
  const trend = buildScoreTrendFacts(input.kpiReport);

  // ── Period attribution (deterministic; unattributed surfaced) ──
  const attributedObservations = attributeRecords(input.observations, monthOfObservation, monthKey, windowMonths);
  const attributedDeductions = attributeRecords(input.deductions, monthOfQualityDeduction, monthKey, windowMonths);
  const attributedComplaints = attributeRecords(input.complaints, monthOfComplaint, monthKey, windowMonths);
  const attributedCapa = attributeRecords(input.capaSplit.primary, monthOfCapa, monthKey, windowMonths);
  const attributedFollowUps = attributeRecords(input.followUps, monthOfFollowUp, monthKey, windowMonths);
  const attributedDeals = attributeRecords(input.deals, monthOfTravelDeal, monthKey, windowMonths);

  const unattributed: Array<{ collection: string; count: number }> = [
    { collection: 'qualityObservations', count: attributedObservations.unattributed },
    { collection: 'qualityDeductions', count: attributedDeductions.unattributed },
    { collection: 'complaints', count: attributedComplaints.unattributed },
    { collection: 'capaCases', count: attributedCapa.unattributed },
    { collection: 'followUps', count: attributedFollowUps.unattributed },
    { collection: 'travelDeals', count: attributedDeals.unattributed },
  ];

  // ── Quality analysis (period scope) ──
  const periodObservations = attributedObservations.inPeriod;
  const observations = aggregateObservations({
    observations: periodObservations,
    windowObservations: attributedObservations.inWindow,
    windowMonths,
  });
  const repeated = detectRepeatedIssues({ observations: periodObservations, minOccurrences });
  const windowRecurrence = detectWindowRecurrence({
    observations: attributedObservations.inWindow,
    windowMonths,
    minOccurrences,
  });
  const deductions = aggregateQualityDeductions({ records: attributedDeductions.inPeriod });

  // ── §14 Trend series across the window (counts of actual records
  //      only — months without data are absent, never zero-filled) ──
  const complaintsMonthly = countByMonth(
    windowMonths,
    attributedComplaints.inWindow.map((r) => ({ month: monthOfComplaint(r) })),
  );
  const capaMonthly = countByMonth(
    windowMonths,
    attributedCapa.inWindow.map((r) => ({ month: monthOfCapa(r) })),
  );
  const followUpsMonthly = countByMonth(
    windowMonths,
    attributedFollowUps.inWindow.map((r) => ({ month: monthOfFollowUp(r) })),
  );

  // ── Operations analysis ──
  const complaints = aggregateComplaints({
    complaints: attributedComplaints.inPeriod,
    minOccurrences,
    monthly: complaintsMonthly,
    now,
  });
  const capa = aggregateCapaCases({
    capaCases: attributedCapa.inPeriod,
    indirectCount: input.capaSplit.indirect.length,
    monthly: capaMonthly,
    now,
  });
  const followUps = aggregateFollowUps({
    followUps: attributedFollowUps.inPeriod,
    monthly: followUpsMonthly,
    now,
  });
  const dealMonthById = new Map(input.deals.map((d) => [d.id, monthOfTravelDeal(d)] as const));
  const deals = aggregateTravelDeals({
    deals: attributedDeals.inPeriod,
    windowDeals: attributedDeals.inWindow,
    monthByDealId: dealMonthById,
    windowMonths,
  });

  // ── Attendance context (stored result only) ──
  const attendance = buildAttendanceContext(input.attendanceResult);

  return {
    datasetKind: 'EMPLOYEE_PERFORMANCE_INTELLIGENCE',
    employee: buildIdentityFacts({ employeeId, identity: input.identity, kpiReport: input.kpiReport }),
    period: {
      monthKey,
      valueBasis: input.kpiReport.period.valueBasis,
      finalized: input.kpiReport.period.finalizedAt !== null,
      finalizedAt: input.kpiReport.period.finalizedAt,
    },
    kpi,
    trend,
    quality: {
      observations,
      repeatedIssues: {
        groupBasis: { category: 'categoryId', type: 'type' },
        minOccurrences,
        byCategory: repeated.byCategory,
        byType: repeated.byType,
        windowByCategory: windowRecurrence,
      },
      deductions,
    },
    complaints,
    capa,
    followUps,
    deals,
    attendance,
    dataQuality: buildDataQuality({ windowMonths, unattributed }),
    evidence: buildEvidenceGraph({
      monthKey,
      kpiReport: input.kpiReport,
      observations: periodObservations,
      deductions: attributedDeductions.inPeriod,
      complaints: attributedComplaints.inPeriod,
      capaCases: attributedCapa.inPeriod,
      followUps: attributedFollowUps.inPeriod,
      deals: attributedDeals.inPeriod,
      attendanceResult: input.attendanceResult,
    }),
    generatedAt: now.toISOString(),
  };
}
