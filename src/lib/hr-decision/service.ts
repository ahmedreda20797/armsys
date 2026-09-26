// ══════════════════════════════════════════════════════════════
//  HR Decision-Support — Service orchestrator
//
//  READ-ONLY wiring of EXISTING canonical sources:
//    • getEmployeePerformanceDataset (lib/performance-intelligence)
//      — the canonical Phase-3 analytical dataset (KPI report from
//      the engine pipeline, follow-ups, quality, complaints, CAPA,
//      deals, stored attendance).
//    • the SAME loaders' raw follow-ups / CAPA cases (for the
//      canonical risk + repetition helpers) and hrDeductions
//      (lib/employee-performance aggregation).
//    • kpiSettings.defaultScore — the CONFIGURED KPI baseline.
//
//  No second KPI engine, no new collections, no writes. Business
//  outcomes are data, never exceptions: null ONLY when the employee
//  does not exist (caller maps to 404).
// ══════════════════════════════════════════════════════════════

import { isValidMonthKey } from '@/lib/month-utils';
import { getKpiSettings } from '@/lib/kpi-settings';
import { aggregateHrMonth, HR_DEDUCTIONS_TABLE } from '@/lib/employee-performance';
import type { EmployeeHrDeductionRecord, EmployeeHrMonthSummary } from '@/lib/employee-performance';
import { getAll } from '@/lib/db';
import {
  getEmployeePerformanceDataset,
  defaultPerformanceIntelligenceLoaders,
} from '@/lib/performance-intelligence';
import type {
  EmployeePerformanceDataset,
  PerformanceIntelligenceLoaders,
} from '@/lib/performance-intelligence';
import { buildHrEmployeeDecisionReport, buildHrEmployeeOpsFacts, buildHrTeamDecisionReport } from './report';
import type { HrEmployeeDecisionReport, HrTeamDecisionReport } from './types';

export interface GetHrEmployeeDecisionInput {
  employeeId: string;
  /** YYYY-MM reported period. */
  monthKey: string;
  /** Analysis window length INCLUDING the reported month (default 6). */
  windowMonths?: number;
  now?: Date;
  loaders?: PerformanceIntelligenceLoaders;
  /**
   * Pre-built canonical dataset (Employee 360 composes the decision
   * report over the SAME dataset it already built — no second engine
   * run). When omitted, the service builds it from the loaders.
   */
  dataset?: EmployeePerformanceDataset;
  /**
   * Stored HR deduction reader (the hrDeductions collection via the
   * established employee-performance table constant). Injectable for
   * tests; defaults to the same cached db read the existing
   * employee-performance service uses.
   */
  loadHrDeductions?: (employeeId: string) => Promise<EmployeeHrDeductionRecord[]>;
  /** kpiSettings reader override (tests); defaults to getKpiSettings. */
  loadTargetScore?: () => Promise<number>;
}

/** Default HR-deduction reader — ONE cached read, filtered in memory. */
async function defaultLoadHrDeductions(employeeId: string): Promise<EmployeeHrDeductionRecord[]> {
  const all = await getAll<EmployeeHrDeductionRecord>(HR_DEDUCTIONS_TABLE);
  return all.filter((r) => r && r.employeeId === employeeId);
}

/**
 * Build one employee's HR decision-support report. Returns null ONLY
 * when the employee does not exist.
 */
export async function getHrEmployeeDecisionReport(
  input: GetHrEmployeeDecisionInput,
): Promise<HrEmployeeDecisionReport | null> {
  if (!isValidMonthKey(input.monthKey)) {
    throw new Error(`invalid month key: ${String(input.monthKey)}`);
  }

  const loaders = input.loaders ?? defaultPerformanceIntelligenceLoaders;
  const now = input.now ?? new Date();

  const [datasetOrUndefined, settings, followUps, capaSplit, hrRecords] = await Promise.all([
    input.dataset
      ? Promise.resolve(input.dataset)
      : getEmployeePerformanceDataset({
          employeeId: input.employeeId,
          monthKey: input.monthKey,
          windowMonths: input.windowMonths,
          now,
          loaders,
        }),
    input.loadTargetScore
      ? input.loadTargetScore()
      : getKpiSettings().then((s) => s.defaultScore),
    loaders.loadFollowUps(input.employeeId),
    loaders.loadCapaCases(input.employeeId),
    input.loadHrDeductions
      ? input.loadHrDeductions(input.employeeId)
      : defaultLoadHrDeductions(input.employeeId),
  ]);

  const dataset = datasetOrUndefined;
  if (!dataset) return null;

  const hrMonth = buildHrMonthSummary(input.monthKey, hrRecords);

  return buildHrEmployeeDecisionReport({
    monthKey: input.monthKey,
    targetScore: settings,
    dataset,
    followUps,
    capaCases: capaSplit.primary,
    hrMonth,
    now,
  });
}

/** The stored HR month summary for the reported period (null when no records — never zeros). */
function buildHrMonthSummary(
  monthKey: string,
  records: ReadonlyArray<EmployeeHrDeductionRecord>,
): EmployeeHrMonthSummary | null {
  const inMonth = records.filter((r) => r && r.month === monthKey);
  if (inMonth.length === 0) return null;
  return aggregateHrMonth(monthKey, [...inMonth]);
}

export interface GetHrTeamDecisionInput {
  /** YYYY-MM reported period. */
  monthKey: string;
  /**
   * The AUTHORIZED employee population (the caller — the route —
   * resolves the existing scope engine FIRST; this service never
   * widens it).
   */
  employeeIds: ReadonlyArray<string>;
  windowMonths?: number;
  now?: Date;
  loaders?: PerformanceIntelligenceLoaders;
  loadHrDeductions?: (employeeId: string) => Promise<EmployeeHrDeductionRecord[]>;
  loadTargetScore?: () => Promise<number>;
}

/**
 * Build the team/department aggregate over the authorized population.
 * One employee failing to load (deleted mid-request) skips that row
 * deterministically — the aggregate counts only what was built.
 */
export async function getHrTeamDecisionReport(
  input: GetHrTeamDecisionInput,
): Promise<HrTeamDecisionReport> {
  if (!isValidMonthKey(input.monthKey)) {
    throw new Error(`invalid month key: ${String(input.monthKey)}`);
  }
  const now = input.now ?? new Date();

  const results = await Promise.all(
    input.employeeIds.map(async (employeeId) =>
      getHrEmployeeDecisionReport({
        employeeId,
        monthKey: input.monthKey,
        windowMonths: input.windowMonths,
        now,
        loaders: input.loaders,
        loadHrDeductions: input.loadHrDeductions,
        loadTargetScore: input.loadTargetScore,
      }),
    ),
  );

  const built = results.filter((r): r is HrEmployeeDecisionReport => r !== null);

  // Ops facts derive from the SAME scorecard metrics each employee
  // report was built from (the same canonical numbers, re-projected).
  const opsFacts = new Map(
    built.map((report) => [report.employee.employeeId, opsFactsFromReport(report)]),
  );

  const first = built[0];
  return buildHrTeamDecisionReport({
    monthKey: input.monthKey,
    valueBasis: first?.period.valueBasis ?? 'LIVE',
    finalized: first?.period.finalized ?? false,
    reports: built,
    opsFacts,
    now,
  });
}

/**
 * Rebuild the operational snapshot from the report's own scorecard
 * metrics (labeled, deterministic) — the values are the same
 * canonical numbers, re-projected for the aggregate.
 */
function opsFactsFromReport(report: HrEmployeeDecisionReport) {
  const metric = (category: string, labelAr: string): number | null => {
    const entry = report.scorecard.find((e) => e.category === category);
    if (!entry) return null;
    const m = entry.metrics.find((x) => x.labelAr === labelAr);
    return m ? m.value : null;
  };
  const followUpTotal = metric('FOLLOW_UP', 'إجمالي متابعات الفترة') ?? 0;
  const overdueNow = metric('FOLLOW_UP', 'متأخرة حالياً') ?? 0;
  const completionRate = metric('FOLLOW_UP', 'معدل الإنجاز');
  const compliance = metric('ATTENDANCE', 'نسبة الالتزام');
  const lateDays = metric('ATTENDANCE', 'أيام التأخير') ?? 0;
  const absentDays = metric('ATTENDANCE', 'أيام الغياب') ?? 0;
  const dealsTravelVolume = metric('PRODUCTIVITY', 'حجم السفر (تاريخ المغادرة)') ?? 0;
  const dealsClosed = metric('PRODUCTIVITY', 'صفقات مكتملة (تاريخ الإغلاق)') ?? 0;
  return {
    followUpTotal,
    followUpOverdue: overdueNow,
    followUpCompletionRate: completionRate,
    attendanceCompliance: compliance,
    attendanceLateDays: lateDays,
    attendanceAbsentDays: absentDays,
    dealsTravelVolume,
    dealsClosed,
  };
}

// buildHrEmployeeOpsFacts stays exported for callers that hold the
// raw dataset (tests, future surfaces reading the dataset directly).
export { buildHrEmployeeOpsFacts };
