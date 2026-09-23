// ══════════════════════════════════════════════════════════════
//  HR Decision-Support — Report Assembly
//
//  PURE: combines the canonical dataset (performance-intelligence),
//  the raw employee-linked records the loaders already return, and
//  the stored HR month summary into the two HR-safe view models:
//    • buildHrEmployeeDecisionReport — the per-employee report
//    • buildHrTeamDecisionReport    — the team/department aggregate
//
//  Every value is a deterministic projection; nothing is recomputed,
//  nothing fabricated, and no technical field has a destination in
//  the output shapes (see types.ts — the view models structurally
//  exclude observation text, deduction reasons, complaint/CAPA
//  details, customer data, evidence ids and component math).
// ══════════════════════════════════════════════════════════════

import type { CAPACase, FollowUp } from '@/types';
import { computeRisk } from '@/lib/metrics/riskMetrics';
import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence';
import type { EmployeeHrMonthSummary } from '@/lib/employee-performance';
import {
  HR_DECISION_CATEGORY_LABELS_AR,
  HR_DECISION_STATUS_LABELS_AR,
  HR_DECISION_STATUS_ORDER,
  HR_ACTION_DISCLAIMER_AR,
} from './types';
import type {
  HrDecisionDataQuality,
  HrDecisionExecutiveSummary,
  HrDecisionFactor,
  HrDecisionThresholds,
  HrDecisionTrendSection,
  HrDimensionScorecardEntry,
  HrDecisionEmployeeHeader,
  HrEmployeeDecisionReport,
  HrTeamDecisionOperationalTotals,
  HrTeamDecisionReport,
  HrTeamDecisionRow,
  HrTeamDecisionTotals,
} from './types';
import {
  buildAllFactors,
  buildRecommendedAction,
  evaluateHrStatus,
} from './status-engine';
import {
  buildCapaRiskStats,
  buildDecisionRiskInput,
  buildFollowUpWindowStats,
  buildKpiTrendCounters,
} from './signals';
import { countAr, daysAr, pctAr, pointsAr } from './format';

/** The thresholds the engine used (echoed into tests + future UI). */
export function hrDecisionThresholds(targetScore: number): HrDecisionThresholds {
  return {
    kpiTargetScore: targetScore,
    kpiTargetBasis: 'CONFIGURED',
    kpiTargetSource: 'kpiSettings.defaultScore',
    attendanceMinimumCompliance: null,
    attendanceBasis: 'CONFIGURATION_REQUIRED',
    followUpOverdueMaximum: null,
    followUpBasis: 'CONFIGURATION_REQUIRED',
    riskBands: { medium: 11, high: 26, critical: 51 },
    riskBasis: 'CANONICAL_RISK',
  };
}

export interface AssembleHrEmployeeDecisionInput {
  monthKey: string;
  /** Configured KPI baseline (kpiSettings.defaultScore) — reused, never invented. */
  targetScore: number;
  dataset: EmployeePerformanceDataset;
  /** Raw employee follow-ups (same loaders the dataset consumed). */
  followUps: ReadonlyArray<FollowUp>;
  /** Primary-link CAPA cases (capaCases.employeeId). */
  capaCases: ReadonlyArray<CAPACase>;
  /** Stored HR deduction month summary (null when no records for the period). */
  hrMonth: EmployeeHrMonthSummary | null;
  now: Date;
}

// ─────────────────────────────────────────────────────────────
//  Scorecard assembly
// ─────────────────────────────────────────────────────────────

function kpiScorecardEntry(
  dataset: EmployeePerformanceDataset,
  kpiScore: number | null,
  momDeltaPoints: number | null,
  targetScore: number,
): HrDimensionScorecardEntry {
  const category = 'KPI' as const;
  if (kpiScore === null) {
    return {
      category,
      labelAr: HR_DECISION_CATEGORY_LABELS_AR[category],
      availability: 'NOT_AVAILABLE',
      unavailableReasonAr:
        dataset.kpi.message
        ?? 'لا توجد نتيجة أداء لهذه الفترة (حالة النتيجة محفوظة كما هي دون تفسير)',
      state: 'UNKNOWN',
      metrics: [],
    };
  }
  const below = kpiScore < targetScore;
  return {
    category,
    labelAr: HR_DECISION_CATEGORY_LABELS_AR[category],
    availability: 'AVAILABLE',
    unavailableReasonAr: null,
    state: below ? 'WEAK' : 'OK',
    metrics: [
      { labelAr: 'نتيجة الأداء', value: kpiScore, unit: 'points', hintAr: null },
      { labelAr: 'الهدف المُهيّأ', value: targetScore, unit: 'points', hintAr: 'إعدادات المؤشرات (defaultScore)' },
      {
        labelAr: 'الفارق عن الشهر السابق',
        value: momDeltaPoints,
        unit: 'points',
        hintAr: momDeltaPoints === null ? 'لا توجد مقارنة شهر سابق' : null,
      },
      { labelAr: 'حالة نتيجة الشهر', value: null, unit: 'count', hintAr: dataset.kpi.rowStatus },
    ],
  };
}

function followUpScorecardEntry(
  dataset: EmployeePerformanceDataset,
  overdueMonths: number,
  activeTotal: number,
): HrDimensionScorecardEntry {
  const category = 'FOLLOW_UP' as const;
  const f = dataset.followUps;
  if (f.total === 0 && activeTotal === 0) {
    return {
      category,
      labelAr: HR_DECISION_CATEGORY_LABELS_AR[category],
      availability: 'NOT_AVAILABLE',
      unavailableReasonAr: 'لا توجد متابعات مرتبطة بالموظف في هذه الفترة',
      state: 'UNKNOWN',
      metrics: [],
    };
  }
  return {
    category,
    labelAr: HR_DECISION_CATEGORY_LABELS_AR[category],
    availability: 'AVAILABLE',
    unavailableReasonAr: null,
    state: overdueMonths >= 2 ? 'WEAK' : f.overdue > 0 || activeTotal > 0 ? 'WATCH' : 'OK',
    metrics: [
      { labelAr: 'إجمالي متابعات الفترة', value: f.total, unit: 'count', hintAr: null },
      { labelAr: 'مكتملة', value: f.completed, unit: 'count', hintAr: null },
      { labelAr: 'معدل الإنجاز', value: f.completionRate, unit: 'percent', hintAr: null },
      { labelAr: 'متأخرة حالياً', value: f.overdue, unit: 'count', hintAr: 'لا يوجد حد مُهيّأ لنسبة التأخير' },
      { labelAr: 'متوسط أيام التأخير', value: f.avgOverdueDays, unit: 'days', hintAr: null },
      { labelAr: 'مفتوحة حالياً', value: activeTotal, unit: 'count', hintAr: null },
      { labelAr: 'شهور بها تأخير (نافذة)', value: overdueMonths, unit: 'months', hintAr: null },
    ],
  };
}

function qualityScorecardEntry(dataset: EmployeePerformanceDataset): HrDimensionScorecardEntry {
  const category = 'QUALITY' as const;
  const hasRecords =
    dataset.quality.observations.total > 0 ||
    dataset.quality.deductions.count > 0 ||
    dataset.complaints.total > 0 ||
    dataset.capa.total > 0;
  const repeatedCount = dataset.quality.repeatedIssues.byCategory.length;
  if (!hasRecords) {
    return {
      category,
      labelAr: HR_DECISION_CATEGORY_LABELS_AR[category],
      availability: 'NOT_AVAILABLE',
      unavailableReasonAr: 'لا توجد سجلات جودة (ملاحظات/خصومات/شكاوى/CAPA) مرتبطة بالموظف في الفترة',
      state: 'UNKNOWN',
      metrics: [],
    };
  }
  return {
    category,
    labelAr: HR_DECISION_CATEGORY_LABELS_AR[category],
    availability: 'AVAILABLE',
    unavailableReasonAr: null,
    state: repeatedCount > 0 || dataset.complaints.stillOpen > 0 ? 'WEAK'
      : dataset.quality.deductions.count > 0 || dataset.capa.active > 0 ? 'WATCH' : 'OK',
    // HR-safe aggregates only — counts and recurrence, never reasons/text.
    metrics: [
      { labelAr: 'عدد ملاحظات الجودة', value: dataset.quality.observations.total, unit: 'count', hintAr: null },
      { labelAr: 'خصومات جودة مؤثرة', value: dataset.quality.deductions.count, unit: 'count', hintAr: null },
      { labelAr: 'أنماط جودة متكررة (نافذة)', value: repeatedCount, unit: 'count', hintAr: null },
      { labelAr: 'شكاوى مرتبطة', value: dataset.complaints.total, unit: 'count', hintAr: null },
      { labelAr: 'شكاوى مفتوحة', value: dataset.complaints.stillOpen, unit: 'count', hintAr: null },
      { labelAr: 'إجراءات CAPA نشطة', value: dataset.capa.active, unit: 'count', hintAr: null },
    ],
  };
}

function attendanceScorecardEntry(dataset: EmployeePerformanceDataset): HrDimensionScorecardEntry {
  const category = 'ATTENDANCE' as const;
  if (dataset.attendance.status !== 'AVAILABLE' || !dataset.attendance.result) {
    return {
      category,
      labelAr: HR_DECISION_CATEGORY_LABELS_AR[category],
      availability: 'NOT_AVAILABLE',
      unavailableReasonAr: 'بيانات الحضور غير متاحة لهذه الفترة — لا توجد نتيجة شهرية مخزّنة',
      state: 'UNKNOWN',
      metrics: [],
    };
  }
  const r = dataset.attendance.result;
  return {
    category,
    labelAr: HR_DECISION_CATEGORY_LABELS_AR[category],
    availability: 'AVAILABLE',
    unavailableReasonAr: null,
    // Data present, but Qnalys configures NO minimum compliance —
    // judgment requires configuration; the values stay reported-only.
    state: 'UNKNOWN',
    metrics: [
      { labelAr: 'نسبة الالتزام', value: r.compliance, unit: 'percent', hintAr: 'قيمة مقاسة — لا يوجد حد أدنى مُهيّأ' },
      { labelAr: 'أيام العمل', value: r.workDays, unit: 'count', hintAr: null },
      { labelAr: 'أيام الحضور', value: r.presentDays, unit: 'count', hintAr: null },
      { labelAr: 'أيام التأخير', value: r.lateDays, unit: 'count', hintAr: null },
      { labelAr: 'أيام الغياب', value: r.absentDays, unit: 'count', hintAr: null },
      { labelAr: 'إجمالي دقائق التأخير', value: r.totalMinutesLate, unit: 'minutes', hintAr: null },
      { labelAr: 'أيام خصم الحضور', value: r.attendanceDeductionDays, unit: 'days', hintAr: null },
    ],
  };
}

function hrDisciplinaryScorecardEntry(
  hrMonth: EmployeeHrMonthSummary | null,
): HrDimensionScorecardEntry {
  const category = 'HR_DISCIPLINARY' as const;
  if (hrMonth === null) {
    return {
      category,
      labelAr: HR_DECISION_CATEGORY_LABELS_AR[category],
      availability: 'NOT_AVAILABLE',
      unavailableReasonAr: 'لا توجد سجلات خصم موارد بشرية لهذه الفترة',
      state: 'UNKNOWN',
      metrics: [],
    };
  }
  return {
    category,
    labelAr: HR_DECISION_CATEGORY_LABELS_AR[category],
    availability: 'AVAILABLE',
    unavailableReasonAr: null,
    state: hrMonth.deductionCount > 0 ? 'WATCH' : 'OK',
    metrics: [
      { labelAr: 'عدد الخصومات', value: hrMonth.deductionCount, unit: 'count', hintAr: null },
      { labelAr: 'أيام الخصم', value: hrMonth.deductionDays, unit: 'days', hintAr: null },
      { labelAr: 'قيمة الخصم', value: hrMonth.deductionAmount, unit: 'count', hintAr: null },
    ],
  };
}

function productivityScorecardEntry(dataset: EmployeePerformanceDataset): HrDimensionScorecardEntry {
  const category = 'PRODUCTIVITY' as const;
  const d = dataset.deals;
  // §DEAL-DATES — productivity reads the CLOSED dimension (closedAt);
  // travel volume reads the TRAVEL dimension (departureDate). The two
  // are separate facts and are labeled as such — never one ambiguous
  // "deals" number.
  if (d.travelTotal === 0 && d.closedTotal === 0 && d.closedUnknownMonth === 0) {
    return {
      category,
      labelAr: HR_DECISION_CATEGORY_LABELS_AR[category],
      availability: 'NOT_AVAILABLE',
      unavailableReasonAr: 'لا توجد بيانات إنتاجية مرتبطة بالموظف لهذه الفترة',
      state: 'UNKNOWN',
      metrics: [],
    };
  }
  return {
    category,
    labelAr: HR_DECISION_CATEGORY_LABELS_AR[category],
    availability: 'AVAILABLE',
    unavailableReasonAr: null,
    // Output facts only — Qnalys configures no productivity target.
    state: 'UNKNOWN',
    metrics: [
      { labelAr: 'صفقات مكتملة (تاريخ الإغلاق)', value: d.closedTotal, unit: 'count', hintAr: 'تُنسب بالتاريخ الفعلي لإغلاق الصفقة' },
      { labelAr: 'حجم السفر (تاريخ المغادرة)', value: d.travelTotal, unit: 'count', hintAr: 'تُنسب بتاريخ سفر العميل' },
      { labelAr: 'ملغاة', value: d.canceled, unit: 'count', hintAr: null },
      { labelAr: 'قيد التنفيذ/قادمة', value: d.active, unit: 'count', hintAr: null },
      ...(d.closedUnknownMonth > 0
        ? [{ labelAr: 'مكتملة بتاريخ إغلاق غير محدد', value: d.closedUnknownMonth, unit: 'count' as const, hintAr: 'لا يوجد طابع زمني موثوق للإغلاق — لا تُنسب لأي شهر' }]
        : []),
    ],
  };
}

// ─────────────────────────────────────────────────────────────
//  Data quality (HR-safe phrasing)
// ─────────────────────────────────────────────────────────────

function buildDataQuality(
  entries: HrDimensionScorecardEntry[],
  dataset: EmployeePerformanceDataset,
): HrDecisionDataQuality {
  const notesAr: string[] = [];
  for (const entry of entries) {
    if (entry.availability === 'NOT_AVAILABLE' && entry.unavailableReasonAr) {
      notesAr.push(entry.unavailableReasonAr);
    }
  }
  notesAr.push('لا يوجد حد أدنى مُهيّأ للالتزام بالحضور في إعدادات Qnals — القيم تُعرض كقياسات فقط.');
  notesAr.push('لا يوجد هدف إنتاجية مُهيّأ في إعدادات Qnals — القيم تُعرض كقياسات فقط.');
  notesAr.push('لا يوجد حد مُهيّأ لنسبة تأخير المتابعات في إعدادات Qnals — القيم تُعرض كقياسات فقط.');
  const unattributed = dataset.dataQuality.unattributedRecords;
  if (unattributed.length > 0) {
    const total = unattributed.reduce((sum, u) => sum + u.count, 0);
    notesAr.push(`${countAr(total)} سجلاً بلا تاريخ صالح استُثنيت من تحليل الفترة (لم تُنسب لأي شهر تخمينياً).`);
  }

  const availableCount = entries.filter((e) => e.availability === 'AVAILABLE').length;
  const kpiEntry = entries.find((e) => e.category === 'KPI');
  const kpiAvailable = kpiEntry?.availability === 'AVAILABLE';
  const sufficiency =
    !kpiAvailable && availableCount <= 1 ? 'INSUFFICIENT'
      : kpiAvailable && availableCount >= 4 ? 'SUFFICIENT'
        : 'PARTIAL';

  return { sufficiency, notesAr };
}

// ─────────────────────────────────────────────────────────────
//  Employee decision report
// ─────────────────────────────────────────────────────────────

export function buildHrEmployeeDecisionReport(
  input: AssembleHrEmployeeDecisionInput,
): HrEmployeeDecisionReport {
  const { monthKey, targetScore, dataset, hrMonth, now } = input;
  const windowMonths = dataset.dataQuality.windowMonths;

  // Deterministic signals over canonical data.
  const kpi = buildKpiTrendCounters(dataset, targetScore);
  const followUpStats = buildFollowUpWindowStats(input.followUps, windowMonths, now);
  const capaStats = buildCapaRiskStats(input.capaCases, now);
  const riskInput = buildDecisionRiskInput({ dataset, hrMonth, followUpStats, capaStats });
  const risk = computeRisk(riskInput);

  // Factors + deterministic status + recommended action.
  const ctx = { dataset, hrMonth, followUps: followUpStats, capaStats, kpi, targetScore };
  const factors = buildAllFactors(ctx);
  const evaluation = evaluateHrStatus({
    factors,
    kpi,
    riskScore: risk.score,
    riskLevel: risk.level,
  });
  const action = buildRecommendedAction(evaluation);

  // Scorecard (six HR-safe dimensions; trend has its own section).
  const scorecard: HrDimensionScorecardEntry[] = [
    kpiScorecardEntry(dataset, kpi.currentScore, kpi.momDeltaPoints, targetScore),
    followUpScorecardEntry(dataset, followUpStats.overdueMonths.length, followUpStats.activeTotal),
    productivityScorecardEntry(dataset),
    qualityScorecardEntry(dataset),
    attendanceScorecardEntry(dataset),
    hrDisciplinaryScorecardEntry(hrMonth),
  ];

  const trend: HrDecisionTrendSection = {
    windowMonths: [...windowMonths],
    points: dataset.trend.points.map((p) => ({
      monthKey: p.monthKey,
      available: p.available,
      rawScore: p.rawScore,
    })),
    direction: kpi.direction,
    momDeltaPoints: kpi.momDeltaPoints,
    monthsWithScore: kpi.monthsWithScore,
    consecutiveBelowTarget: kpi.consecutiveBelowTarget,
    consecutiveDecliningSteps: kpi.consecutiveDecliningSteps,
    targetScore,
  };

  const strengths = factors.filter((f) => f.kind === 'POSITIVE');
  const concerns = factors.filter((f) => f.kind === 'NEGATIVE');

  const executive: HrDecisionExecutiveSummary = {
    status: evaluation.status,
    statusLabelAr: HR_DECISION_STATUS_LABELS_AR[evaluation.status],
    actionKind: action.actionKind,
    actionAr: action.actionAr,
    kpiScore: kpi.currentScore,
    kpiRowStatus: dataset.kpi.rowStatus,
    trendDirection: kpi.direction,
    momDeltaPoints: kpi.momDeltaPoints,
    riskLevel: risk.level,
    riskScore: risk.score,
  };

  const employee: HrDecisionEmployeeHeader = {
    employeeId: dataset.employee.employeeId,
    employeeName: dataset.employee.employeeName,
    employeeCode: dataset.employee.employeeCode,
    department: dataset.employee.department,
    team: dataset.employee.team,
    position: dataset.employee.position,
    employmentStatus: dataset.employee.employmentStatus,
    archivedButEligible: dataset.employee.archivedButEligible,
  };

  return {
    reportKind: 'HR_EMPLOYEE_DECISION',
    audience: 'HR',
    employee,
    period: {
      monthKey,
      valueBasis: dataset.period.valueBasis,
      finalized: dataset.period.finalized,
    },
    executive,
    scorecard,
    trend,
    factors,
    strengths,
    concerns,
    action,
    dataQuality: buildDataQuality(scorecard, dataset),
    generatedAt: now.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────
//  Team / department aggregate
// ─────────────────────────────────────────────────────────────

/** Per-employee operational snapshot the service derives alongside each report. */
export interface HrEmployeeOpsFacts {
  followUpTotal: number;
  followUpOverdue: number;
  followUpCompletionRate: number | null;
  attendanceCompliance: number | null;
  attendanceLateDays: number;
  attendanceAbsentDays: number;
  dealsTravelVolume: number;
  dealsClosed: number;
}

export function buildHrEmployeeOpsFacts(dataset: EmployeePerformanceDataset): HrEmployeeOpsFacts {
  const attendance = dataset.attendance.status === 'AVAILABLE' && dataset.attendance.result
    ? dataset.attendance.result
    : null;
  return {
    followUpTotal: dataset.followUps.total,
    followUpOverdue: dataset.followUps.overdue,
    followUpCompletionRate: dataset.followUps.completionRate,
    attendanceCompliance: attendance ? attendance.compliance : null,
    attendanceLateDays: attendance ? attendance.lateDays : 0,
    attendanceAbsentDays: attendance ? attendance.absentDays : 0,
    // §DEAL-DATES — the two dimensions travel separately.
    dealsTravelVolume: dataset.deals.travelTotal,
    dealsClosed: dataset.deals.closedTotal,
  };
}

function average(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((s, v) => s + v, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

function topConcernSignal(concerns: ReadonlyArray<HrDecisionFactor>): string | null {
  const judged = concerns.find((c) => c.severity !== 'LOW');
  return judged ? judged.signalAr : null;
}

export interface AssembleHrTeamDecisionInput {
  monthKey: string;
  valueBasis: EmployeePerformanceDataset['period']['valueBasis'];
  finalized: boolean;
  /** Employee reports for the AUTHORIZED population (already scope-narrowed). */
  reports: ReadonlyArray<HrEmployeeDecisionReport>;
  /** Ops facts keyed by the same employee ids. */
  opsFacts: ReadonlyMap<string, HrEmployeeOpsFacts>;
  now: Date;
}

/**
 * Build the team/department aggregate: status DISTRIBUTIONS and
 * HR-safe operational totals. Individual rows carry the sanitized
 * decision summary only — never technical evidence.
 */
export function buildHrTeamDecisionReport(input: AssembleHrTeamDecisionInput): HrTeamDecisionReport {
  const { reports, opsFacts, now } = input;

  const totals: HrTeamDecisionTotals = {
    employees: reports.length,
    stable: 0,
    improving: 0,
    needsCoaching: 0,
    performanceImprovementReview: 0,
    managementReview: 0,
    withKpiResult: 0,
    averageKpi: null,
  };
  const operational: HrTeamDecisionOperationalTotals = {
    followUps: { employeesWithData: 0, averageCompletionRate: null, totalOverdue: 0, averageOverdueRate: null },
    attendance: { employeesWithResult: 0, averageCompliance: null, totalLateDays: 0, totalAbsentDays: 0 },
    productivity: { employeesWithDeals: 0, travelVolume: 0, closedDeals: 0 },
    trend: { improving: 0, stable: 0, declining: 0, noData: 0 },
  };

  const kpiScores: number[] = [];
  const completionRates: number[] = [];
  const overdueRates: number[] = [];
  const compliances: number[] = [];

  for (const report of reports) {
    switch (report.executive.status) {
      case 'STABLE': totals.stable += 1; break;
      case 'IMPROVING': totals.improving += 1; break;
      case 'NEEDS_COACHING': totals.needsCoaching += 1; break;
      case 'PERFORMANCE_IMPROVEMENT_REVIEW': totals.performanceImprovementReview += 1; break;
      case 'MANAGEMENT_REVIEW': totals.managementReview += 1; break;
    }
    if (report.executive.kpiScore !== null) {
      totals.withKpiResult += 1;
      kpiScores.push(report.executive.kpiScore);
    }
    switch (report.executive.trendDirection) {
      case 'UP': operational.trend.improving += 1; break;
      case 'DOWN': operational.trend.declining += 1; break;
      case 'STABLE': operational.trend.stable += 1; break;
      default: operational.trend.noData += 1; break;
    }

    const ops = opsFacts.get(report.employee.employeeId);
    if (ops) {
      if (ops.followUpTotal > 0) {
        operational.followUps.employeesWithData += 1;
        operational.followUps.totalOverdue += ops.followUpOverdue;
        if (ops.followUpCompletionRate !== null) completionRates.push(ops.followUpCompletionRate);
        if (ops.followUpTotal > 0) {
          overdueRates.push(Math.round(((ops.followUpOverdue / ops.followUpTotal) * 100) * 10) / 10);
        }
      }
      if (ops.attendanceCompliance !== null) {
        operational.attendance.employeesWithResult += 1;
        operational.attendance.totalLateDays += ops.attendanceLateDays;
        operational.attendance.totalAbsentDays += ops.attendanceAbsentDays;
        compliances.push(ops.attendanceCompliance);
      }
      if (ops.dealsTravelVolume > 0 || ops.dealsClosed > 0) {
        operational.productivity.employeesWithDeals += 1;
        operational.productivity.travelVolume += ops.dealsTravelVolume;
        operational.productivity.closedDeals += ops.dealsClosed;
      }
    }
  }

  totals.averageKpi = average(kpiScores);
  operational.followUps.averageCompletionRate = average(completionRates);
  operational.followUps.averageOverdueRate = average(overdueRates);
  operational.attendance.averageCompliance = average(compliances);

  // Distribution order (status severity, then name) — a category
  // grouping, NOT an evaluative leaderboard.
  const rows: HrTeamDecisionRow[] = [...reports]
    .sort(
      (a, b) =>
        HR_DECISION_STATUS_ORDER[a.executive.status] - HR_DECISION_STATUS_ORDER[b.executive.status] ||
        a.employee.employeeName.localeCompare(b.employee.employeeName, 'ar') ||
        a.employee.employeeId.localeCompare(b.employee.employeeId),
    )
    .map((report) => ({
      employeeId: report.employee.employeeId,
      employeeName: report.employee.employeeName,
      employeeCode: report.employee.employeeCode,
      department: report.employee.department,
      team: report.employee.team,
      position: report.employee.position,
      status: report.executive.status,
      actionKind: report.executive.actionKind,
      kpiScore: report.executive.kpiScore,
      trendDirection: report.executive.trendDirection,
      concernCount: report.concerns.filter((c) => c.severity !== 'LOW').length,
      topConcernAr: topConcernSignal(report.concerns),
    }));

  const dataQuality = buildTeamDataQuality(reports);

  return {
    reportKind: 'HR_TEAM_DECISION',
    audience: 'HR',
    monthKey: input.monthKey,
    valueBasis: input.valueBasis,
    finalized: input.finalized,
    totals,
    operational,
    rows,
    dataQuality,
    generatedAt: now.toISOString(),
  };
}

function buildTeamDataQuality(reports: ReadonlyArray<HrEmployeeDecisionReport>) {
  const notesAr: string[] = [];
  const noKpi = reports.filter((r) => r.executive.kpiScore === null).length;
  if (noKpi > 0) notesAr.push(`${countAr(noKpi)} موظفاً بلا نتيجة أداء للفترة (الحالة محفوظة كما هي — لا تُحتسب صفراً).`);
  const noAttendance = reports.filter(
    (r) => r.scorecard.find((e) => e.category === 'ATTENDANCE')?.availability === 'NOT_AVAILABLE',
  ).length;
  if (noAttendance > 0) {
    notesAr.push(`بيانات الحضور غير متاحة لـ ${countAr(noAttendance)} موظفاً في هذه الفترة — الغياب لا يُفسَّر كأداء ضعيف.`);
  }
  notesAr.push('لا توجد حدود مُهيّأة للالتزام بالحضور أو تأخير المتابعات أو الإنتاجية في إعدادات Qnals — تُعرض كقياسات فقط.');
  return { sufficiency: 'PARTIAL' as const, notesAr };
}

// Re-export formatting helpers consumed by the UI/print layer.
export { countAr, daysAr, pctAr, pointsAr, HR_ACTION_DISCLAIMER_AR };
