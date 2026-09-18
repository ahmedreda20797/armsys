// ══════════════════════════════════════════════════════════════
//  Report Runner — Follow-ups (Qnlys milestone §24/§25)
//
//  DETERMINISTIC reporting over the canonical followUps store:
//    • every number derives from real stored records via the
//      canonical metric predicates (lib/metrics/followUpMetrics) —
//      the SAME helpers the dashboard and the page use;
//    • NO LLM/AI, no invented "smart" conclusions — patterns come
//      from arithmetic on the filtered dataset;
//    • insufficient data is reported honestly (empty rows + zero
//      metrics), and the UI shows "بيانات غير كافية للتحليل".
//
//  Two registered shapes (one data path):
//    • follow-ups            — one row per follow-up record
//    • follow-ups-employee   — one row per EMPLOYEE (status
//      distribution, completion/overdue rates, repeated issues)
// ══════════════════════════════════════════════════════════════

import { getAll } from '@/lib/db';
import type { FollowUp } from '@/types';
import {
  isActiveFollowUp, isTerminalFollowUp, isOverdueFollowUp, followUpOverdueDays,
} from '@/lib/metrics/followUpMetrics';
import { applyEmployeeScope } from '../scope';
import type { ResolvedReportRequest } from '../scope';
import { loadEmployeeOrgRefs, employeeMatchesSearch, type EmployeeOrgRef } from '../employee-org';
import type { ReportDataModeInfo, ReportRunnerResult } from '../types';

export const FOLLOW_UPS_SOURCE = 'followUps';

/** Arabic labels for the canonical status vocabulary. */
export const FOLLOW_UP_STATUS_LABELS: Record<string, string> = {
  open: 'مفتوحة',
  under_review: 'قيد المراجعة',
  under_follow_up: 'قيد المتابعة',
  resolved: 'تم الحل',
  closed: 'مغلقة',
  cancelled: 'ملغاة',
};

/** Arabic labels for the follow-up types. */
export const FOLLOW_UP_TYPE_LABELS: Record<string, string> = {
  quality: 'جودة',
  behavior: 'سلوك',
  attendance: 'حضور',
  productivity: 'إنتاجية',
  training: 'تدريب',
  coaching: 'توجيه',
  complaint: 'شكوى',
  positive: 'إيجابي',
  improvement: 'تحسين',
  other: 'أخرى',
};

export function followUpStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return FOLLOW_UP_STATUS_LABELS[status] ?? status;
}

export function followUpTypeLabel(type: string | null | undefined): string {
  if (!type) return 'أخرى';
  return FOLLOW_UP_TYPE_LABELS[type] ?? type;
}

/** One flat report row: one stored follow-up, employee-annotated. */
export interface FollowUpReportRow {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string | null;
  team: string | null;
  date: string;
  /** Human-readable type label (Arabic). */
  type: string;
  subject: string;
  /** Human-readable status label (Arabic). */
  status: string;
  priority: string;
  nextFollowUpDate: string | null;
  /** Canonical overdue days (0 for non-overdue). */
  overdueDays: number;
  responsible: string | null;
}

/**
 * Pure period filtering — ISO `date` compare for ranges, month
 * prefix for month scopes. Records with unusable dates in a range
 * context are excluded (cannot verify inclusion).
 */
export function followUpInPeriod(rec: FollowUp, resolved: ResolvedReportRequest): boolean {
  const monthKeys = resolved.period.monthKeys ? new Set(resolved.period.monthKeys) : null;
  const date = typeof rec.date === 'string' ? rec.date : '';
  if (resolved.period.range) {
    if (date.length < 7) return false;
    const month = date.slice(0, 7);
    if (monthKeys && !monthKeys.has(month)) return false;
    if (date.length === 10) {
      return date >= resolved.period.range.fromDate && date <= resolved.period.range.toDate;
    }
    return true; // month matches; day-level not verifiable
  }
  if (monthKeys) return monthKeys.has(date.slice(0, 7));
  return true;
}

/** Pure filter → rows (scope + department + team + search + status + type + period). */
export function filterFollowUpRecords(
  records: ReadonlyArray<FollowUp>,
  employees: ReadonlyArray<EmployeeOrgRef>,
  resolved: ResolvedReportRequest,
  now: Date = new Date(),
): FollowUpReportRow[] {
  const scopedEmployees = applyEmployeeScope(
    employees.filter((e) => employeeMatchesSearch(e, resolved.search)),
    resolved.employeeScope,
    resolved.department,
    resolved.team,
  );
  const byId = new Map(scopedEmployees.map((e) => [e.id, e]));

  const statusFilter = typeof resolved.filters.status === 'string' && resolved.filters.status ? resolved.filters.status : null;
  const typeFilter = typeof resolved.filters.type === 'string' && resolved.filters.type ? resolved.filters.type : null;

  const rows: FollowUpReportRow[] = [];
  for (const rec of records) {
    const emp = byId.get(rec.employeeId);
    if (!emp) continue;
    if (!followUpInPeriod(rec, resolved)) continue;
    if (statusFilter && rec.status !== statusFilter) continue;
    if (typeFilter && rec.followUpType !== typeFilter) continue;

    rows.push({
      id: rec.id,
      employeeId: rec.employeeId,
      employeeName: emp.name,
      department: emp.department ?? null,
      team: emp.team ?? null,
      date: rec.date,
      type: followUpTypeLabel(rec.followUpType),
      subject: typeof rec.subject === 'string' ? rec.subject : '',
      status: followUpStatusLabel(rec.status),
      priority: rec.priorityLevel ?? 'low',
      nextFollowUpDate: rec.nextFollowUpDate ?? null,
      overdueDays: isOverdueFollowUp(rec, now) ? followUpOverdueDays(rec, now) : 0,
      responsible: (rec as { responsiblePersonName?: string | null }).responsiblePersonName ?? rec.responsiblePerson ?? null,
    });
  }

  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.employeeName.localeCompare(b.employeeName, 'ar');
  });
  return rows;
}

/** Terminal status labels (the completion side of the vocabulary). */
const TERMINAL_STATUS_LABELS: ReadonlySet<string> = new Set(['تم الحل', 'مغلقة', 'ملغاة']);

/** Summary metric keys — exactly the declared availableMetrics ids. */
export function summarizeFollowUps(
  rows: ReadonlyArray<FollowUpReportRow>,
): Record<string, number> {
  const total = rows.length;
  const overdueCount = rows.filter((r) => r.overdueDays > 0).length;
  // Flat rows carry the Arabic status label; the terminal set is the
  // label projection of the canonical terminal statuses.
  const completedCount = rows.filter((r) => TERMINAL_STATUS_LABELS.has(r.status)).length;
  const completionRate = total > 0 ? Math.round((completedCount / total) * 100) : 0;
  const overdueRows = rows.filter((r) => r.overdueDays > 0);
  const avgOverdueDays = overdueRows.length > 0
    ? Math.round((overdueRows.reduce((s, r) => s + r.overdueDays, 0) / overdueRows.length) * 10) / 10
    : 0;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    totalCount: total,
    completedCount,
    pendingCount: total - completedCount,
    overdueCount,
    completionRate,
    avgOverdueDays: round(avgOverdueDays),
  };
}

/** One report row per EMPLOYEE with deterministic per-employee patterns. */
export interface FollowUpEmployeeReportRow {
  employeeId: string;
  employeeName: string;
  department: string | null;
  team: string | null;
  followUpCount: number;
  completedCount: number;
  overdueCount: number;
  /** Percent completed of the employee's follow-ups in the period. */
  completionRate: number;
  /** Mean overdue days over the employee's OVERDUE follow-ups (0 if none). */
  avgOverdueDays: number;
  /** Types with more than one occurrence in the period ("repeated issues"). */
  repeatedIssues: number;
  /** Multi-line "type × count" summary for Excel/print. */
  typesSummary: string;
  /** Multi-line "status × count" distribution. */
  statusDistribution: string;
}

/** Pure per-employee aggregation over the SAME verified flat rows. */
export function groupFollowUpsByEmployee(
  rows: ReadonlyArray<FollowUpReportRow>,
): FollowUpEmployeeReportRow[] {
  const byEmployee = new Map<string, FollowUpEmployeeReportRow>();
  const typeCountByEmployee = new Map<string, Map<string, number>>();
  const statusCountByEmployee = new Map<string, Map<string, number>>();

  for (const row of rows) {
    let group = byEmployee.get(row.employeeId);
    if (!group) {
      group = {
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        department: row.department,
        team: row.team,
        followUpCount: 0,
        completedCount: 0,
        overdueCount: 0,
        completionRate: 0,
        avgOverdueDays: 0,
        repeatedIssues: 0,
        typesSummary: '',
        statusDistribution: '',
      };
      byEmployee.set(row.employeeId, group);
    }
    group.followUpCount += 1;
    if (['تم الحل', 'مغلقة', 'ملغاة'].includes(row.status)) group.completedCount += 1;
    if (row.overdueDays > 0) group.overdueCount += 1;

    const typeCounts = typeCountByEmployee.get(row.employeeId) ?? new Map<string, number>();
    typeCounts.set(row.type, (typeCounts.get(row.type) ?? 0) + 1);
    typeCountByEmployee.set(row.employeeId, typeCounts);

    const statusCounts = statusCountByEmployee.get(row.employeeId) ?? new Map<string, number>();
    statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
    statusCountByEmployee.set(row.employeeId, statusCounts);
  }

  const groups = [...byEmployee.values()];
  for (const g of groups) {
    g.completionRate = g.followUpCount > 0 ? Math.round((g.completedCount / g.followUpCount) * 100) : 0;
    const overdueRows = rows.filter((r) => r.employeeId === g.employeeId && r.overdueDays > 0);
    g.avgOverdueDays = overdueRows.length > 0
      ? Math.round((overdueRows.reduce((s, r) => s + r.overdueDays, 0) / overdueRows.length) * 10) / 10
      : 0;
    const typeCounts = typeCountByEmployee.get(g.employeeId) ?? new Map<string, number>();
    g.repeatedIssues = [...typeCounts.values()].filter((c) => c > 1).length;
    g.typesSummary = [...typeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${type}: ${count}`)
      .join('\n');
    const statusCounts = statusCountByEmployee.get(g.employeeId) ?? new Map<string, number>();
    g.statusDistribution = [...statusCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => `${status}: ${count}`)
      .join('\n');
  }

  groups.sort((a, b) => {
    if (a.followUpCount !== b.followUpCount) return b.followUpCount - a.followUpCount;
    return a.employeeName.localeCompare(b.employeeName, 'ar');
  });
  return groups;
}

/** Flat report orchestrator — two batched reads, no N+1. */
export async function runFollowUpsReport(
  resolved: ResolvedReportRequest,
): Promise<ReportRunnerResult<FollowUpReportRow>> {
  const [records, employees] = await Promise.all([
    getAll<FollowUp>(FOLLOW_UPS_SOURCE),
    loadEmployeeOrgRefs(),
  ]);
  const rows = filterFollowUpRecords(records, employees, resolved);
  const summary = summarizeFollowUps(rows);
  const dataMode: ReportDataModeInfo = {
    dataMode: 'live',
    scopeLabel: resolved.period.label,
    source: FOLLOW_UPS_SOURCE,
  };
  return { rows, summary, hasData: rows.length > 0, dataMode };
}

/** Per-employee report orchestrator — consumes the SAME flat rows. */
export async function runFollowUpsEmployeeReport(
  resolved: ResolvedReportRequest,
): Promise<ReportRunnerResult<FollowUpEmployeeReportRow>> {
  const flat = await runFollowUpsReport(resolved);
  const groups = groupFollowUpsByEmployee(flat.rows);
  const summary = summarizeFollowUps(flat.rows);
  summary.employees = groups.length;
  return { rows: groups, summary, hasData: groups.length > 0, dataMode: flat.dataMode };
}
