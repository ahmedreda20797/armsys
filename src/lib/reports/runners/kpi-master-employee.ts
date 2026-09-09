// ══════════════════════════════════════════════════════════════
//  Unified Reporting Architecture — Master Employee Report (§10)
//
//  ONE row per employee per period: identity, quality scores,
//  deduction count + a bulleted multi-line REASONS cell (each line
//  = date · reason · impact · evidence reference) and a short
//  summary. Built by COMPOSING the existing canonical pieces:
//    • buildMonthlyKpiReport — eligibility, scheme, scores (§10 scores)
//    • qualityDeductions collection — deductions + reasons (day-first)
//    • qualityObservations collection — evidence references
//  No KPI value is computed here (runner doctrine) — everything is
//  read from the canonical engine/stores.
// ══════════════════════════════════════════════════════════════

import { getAll, TTL } from '@/lib/db';
import { buildMonthlyKpiReport } from '@/lib/kpi-reporting';
import type { KpiReportRow } from '@/lib/kpi-reporting';
import type { QualityDeduction } from '@/types';
import type { QualityObservation } from '@/types/quality-kpi';
import type { ResolvedReportRequest } from '../scope';
import type { ReportDataModeInfo, ReportRunnerResult } from '../types';

// ─────────────────────────────────────────────────────────────

export interface KpiMasterEmployeeRow {
  employeeId: string;
  employeeCode: string | null;
  employeeName: string;
  department: string | null;
  /** Reported period (month key). */
  period: string;
  /** Quality RAW score % (null = not available — never fabricated). */
  qualityScore: number | null;
  qualityWeight: number | null;
  qualityContribution: number | null;
  /** Σ contributions of available components (engine output). */
  weightedTotal: number | null;
  qualityStatus: string | null;
  kpiStatus: string;
  /** Number of quality deductions in the period. */
  deductionCount: number;
  /** Total deducted days (day-first rule). */
  deductionDays: number;
  /** Total optional monetary deductions (EGP). */
  deductionAmount: number;
  /** Bulleted, chronological reasons (one line per deduction). */
  deductionReasons: string;
  /** Evidence references (observation ids) supporting the row. */
  evidenceRefs: string;
  /** Short human summary of the row state. */
  summary: string;
  archived: boolean;
}

const round = (n: number) => Math.round(n * 100) / 100;

function scopeLimitOf(resolved: ResolvedReportRequest): ReadonlyArray<string> | null {
  switch (resolved.employeeScope.mode) {
    case 'single': return [resolved.employeeScope.employeeId];
    case 'multiple': return resolved.employeeScope.employeeIds;
    default: return null;
  }
}

/** Reason line for one stored deduction (§10 Excel contract). */
function deductionLine(
  rec: QualityDeduction,
  evidenceById: Map<string, string[]>,
): string {
  const impacts: string[] = [];
  if (typeof rec.deductionAmount === 'number' && rec.deductionAmount > 0) {
    impacts.push(`${round(rec.deductionAmount)} EGP`);
  }
  if (typeof rec.deductionDays === 'number' && rec.deductionDays > 0) {
    impacts.push(`${round(rec.deductionDays)} يوم`);
  }
  const refs = evidenceById.get(rec.id) ?? [];
  const evidence = refs.length > 0 ? ` — Evidence: ${refs.join(', ')}` : '';
  const impact = impacts.length > 0 ? ` — ${impacts.join(' / ')}` : '';
  return `• ${rec.date} — ${rec.type || 'خصم'}${impact}${evidence}`;
}

/**
 * Build the master employee report for one month.
 */
export async function runKpiMasterEmployeeReport(
  resolved: ResolvedReportRequest,
): Promise<ReportRunnerResult<KpiMasterEmployeeRow>> {
  const monthKey = resolved.period.monthKeys?.[0];
  if (!monthKey) {
    throw new Error('Master employee report requires a resolvable month scope');
  }

  const includeArchived = resolved.filters.includeArchived === true || resolved.filters.includeArchived === 'true';

  // ── One read per canonical source (batched, no N+1) ──
  const [report, deductions, observations] = await Promise.all([
    buildMonthlyKpiReport({
      monthKey,
      reportKind: 'MONTHLY',
      now: new Date(),
      filters: {
        department: resolved.department ?? undefined,
        scopeLimit: scopeLimitOf(resolved),
        includeArchived,
      },
    }),
    getAll<QualityDeduction>('qualityDeductions', TTL.DEFAULT),
    getAll<QualityObservation>('qualityObservations', TTL.DEFAULT),
  ]);

  // Evidence references: observation id per linked deduction (via the
  // stored `evidence` string on either side of the link).
  const evidenceById = new Map<string, string[]>();
  const obsByEmployee = new Map<string, string[]>();
  for (const obs of observations) {
    if (!obs || obs.month !== monthKey) continue;
    if (obs.applyPointDeduction && obs.approvalStatus === 'approved') {
      const list = obsByEmployee.get(obs.employeeId) ?? [];
      list.push(`OBS-${obs.id.slice(-6).toUpperCase()}`);
      obsByEmployee.set(obs.employeeId, list);
    }
    const link = typeof obs.evidence === 'string' ? obs.evidence : '';
    if (link) {
      const refs = evidenceById.get(link) ?? [];
      refs.push(`OBS-${obs.id.slice(-6).toUpperCase()}`);
      evidenceById.set(link, refs);
    }
  }

  // Deductions scoped to the month + employee scope of the report.
  const scopedEmployees = new Set(report.rows.map((r) => r.employeeId));
  const deductionsByEmployee = new Map<string, QualityDeduction[]>();
  for (const rec of deductions) {
    if (!rec || rec.month !== monthKey) continue;
    if (!scopedEmployees.has(rec.employeeId)) continue;
    const list = deductionsByEmployee.get(rec.employeeId) ?? [];
    list.push(rec);
    deductionsByEmployee.set(rec.employeeId, list);
  }

  const rows: KpiMasterEmployeeRow[] = report.rows.map((row: KpiReportRow) => {
    const empDeductions = [...(deductionsByEmployee.get(row.employeeId) ?? [])].sort(
      (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0),
    );
    const deductionDays = round(empDeductions.reduce((s, d) => s + (d.deductionDays || 0), 0));
    const deductionAmount = round(empDeductions.reduce((s, d) => s + (d.deductionAmount || 0), 0));
    const reasonLines = empDeductions.map((d) => deductionLine(d, evidenceById));
    const evidence = obsByEmployee.get(row.employeeId) ?? [];

    const summaryParts: string[] = [];
    summaryParts.push(
      row.quality?.rawScore !== null && row.quality?.rawScore !== undefined
        ? `درجة الجودة ${round(row.quality.rawScore)}% بوزن ${row.quality.weight}%`
        : 'لا توجد درجة جودة للفترة',
    );
    if (empDeductions.length > 0) {
      summaryParts.push(`${empDeductions.length} خصم بإجمالي ${deductionDays} يوم${deductionAmount > 0 ? ` و ${deductionAmount} EGP` : ''}`);
    } else {
      summaryParts.push('بدون خصومات جودة');
    }
    if (row.archivedButEligible) summaryParts.push('الموظف مؤرشف (أهلية تاريخية)');

    return {
      employeeId: row.employeeId,
      employeeCode: row.employeeCode,
      employeeName: row.employeeName,
      department: row.department,
      period: monthKey,
      qualityScore: row.quality?.rawScore ?? null,
      qualityWeight: row.quality?.weight ?? null,
      qualityContribution: row.quality?.weightedContribution ?? null,
      weightedTotal: row.weightedTotal,
      qualityStatus: row.quality?.status ?? null,
      kpiStatus: row.rowStatus,
      deductionCount: empDeductions.length,
      deductionDays,
      deductionAmount,
      deductionReasons: reasonLines.join('\n'),
      evidenceRefs: evidence.join(', '),
      summary: summaryParts.join(' — '),
      archived: row.archivedButEligible,
    };
  });

  // Employees ordered alphabetically (Arabic) — a master directory.
  rows.sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'ar'));

  const dataMode: ReportDataModeInfo = {
    dataMode: report.valueBasis === 'FINALIZED' ? 'snapshot' : 'live',
    source: 'kpi-engine + qualityDeductions + qualityObservations',
    scopeLabel: report.valueBasis === 'FINALIZED'
      ? `الشهر ${monthKey} (مجمّد)`
      : `الشهر ${monthKey} (قيم ${report.valueBasis === 'MTD' ? 'MTD حية' : 'حية'})`,
  };

  const totalDeductions = rows.reduce((s, r) => s + r.deductionCount, 0);

  return {
    rows,
    summary: {
      employees: rows.length,
      withDeductions: rows.filter((r) => r.deductionCount > 0).length,
      totalDeductions,
      totalDeductionDays: round(rows.reduce((s, r) => s + r.deductionDays, 0)),
      totalDeductionAmount: round(rows.reduce((s, r) => s + r.deductionAmount, 0)),
      avgQualityScore: rows.filter((r) => r.qualityScore !== null).length > 0
        ? round(rows.reduce((s, r) => s + (r.qualityScore ?? 0), 0) / rows.filter((r) => r.qualityScore !== null).length)
        : 0,
    },
    hasData: rows.length > 0,
    dataMode,
  };
}
