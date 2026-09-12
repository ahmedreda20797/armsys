// ══════════════════════════════════════════════════════════════
//  Unified Reporting Architecture — Master Employee Report (§10)
//
//  ONE row per employee per period: identity, quality scores, KPI
//  point-deduction count + a bulleted multi-line REASONS cell (each
//  line = date · human-readable category · signed points · the real
//  stored reason) and the ACTUAL evidence (URL / text) — built by
//  COMPOSING the existing canonical pieces.
//
//  §SEPARATION (binding): this is a KPI-POINTS report. The payroll
//  "quality discounts" store (qualityDeductions) is a DIFFERENT
//  business domain and is NEVER mixed in here — its days/amounts and
//  reasons belong to the dedicated quality-deductions reports. The
//  deduction columns below come ONLY from APPROVED, point-eligible
//  quality observations (the same records the KPI engine scores).
//
//  §EXPORT-MAPPING: reason lines carry the human-readable
//  categoryName (never an internal key like quality_issue), and the
//  evidence column carries the real stored evidence URL/text — never
//  left empty when evidence exists, never an opaque OBS- id.
// ══════════════════════════════════════════════════════════════

import { getAll, TTL } from '@/lib/db';
import { buildMonthlyKpiReport } from '@/lib/kpi-reporting';
import type { KpiReportRow } from '@/lib/kpi-reporting';
import type { QualityObservation } from '@/types/quality-kpi';
import { classifyEvidence } from '@/lib/quality-observations/evidence';
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
  /** Number of APPROVED point deductions in the period (KPI domain). */
  deductionCount: number;
  /** Σ deducted points (deductions only — bonuses excluded). */
  pointsDeducted: number;
  /** Bulleted, chronological reasons (one line per point deduction). */
  deductionReasons: string;
  /** Actual evidence (URLs / text) supporting the row's deductions. */
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

/** The evidence value a business user should see: the real URL or text. */
function evidenceTextOf(obs: QualityObservation): string {
  const classified = classifyEvidence(obs.evidence);
  if (classified.kind === 'url') return classified.url;
  if (classified.kind === 'text') return classified.text;
  return '';
}

/** Reason line for one KPI point deduction (§10 Excel contract). */
function deductionLine(obs: QualityObservation): string {
  const parts: string[] = [
    obs.categoryName || 'ملاحظة جودة',
    `−${round(obs.points)} نقطة`,
  ];
  const reason = typeof obs.notes === 'string' ? obs.notes.trim() : '';
  if (reason) parts.push(reason);
  return `• ${obs.observationDate || obs.month} — ${parts.join(' — ')}`;
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
  const [report, observations] = await Promise.all([
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
    getAll<QualityObservation>('qualityObservations', TTL.DEFAULT),
  ]);

  // §SEPARATION — the ONLY deduction source: APPROVED, point-eligible
  // quality observations of THIS month (same population the KPI
  // engine scores — src/lib/metrics/kpiMetrics.ts).
  const scoring = observations.filter((o) =>
    o && o.month === monthKey && o.applyPointDeduction && o.approvalStatus === 'approved',
  );
  const scoringByEmployee = new Map<string, QualityObservation[]>();
  for (const obs of scoring) {
    const list = scoringByEmployee.get(obs.employeeId) ?? [];
    list.push(obs);
    scoringByEmployee.set(obs.employeeId, list);
  }

  const rows: KpiMasterEmployeeRow[] = report.rows.map((row: KpiReportRow) => {
    const empObs = [...(scoringByEmployee.get(row.employeeId) ?? [])].sort(
      (a, b) => (a.observationDate < b.observationDate ? -1 : a.observationDate > b.observationDate ? 1 : 0),
    );
    const deductions = empObs.filter((o) => !o.isBonus);
    const bonuses = empObs.filter((o) => o.isBonus);
    const pointsDeducted = round(deductions.reduce((s, o) => s + (o.points || 0), 0));
    const reasonLines = deductions.map(deductionLine);

    // §EVIDENCE — the real stored evidence of every scoring
    // observation (deductions + bonuses), deduplicated.
    const evidences: string[] = [];
    for (const obs of empObs) {
      const text = evidenceTextOf(obs);
      if (text && !evidences.includes(text)) evidences.push(text);
    }

    const summaryParts: string[] = [];
    summaryParts.push(
      row.quality?.rawScore !== null && row.quality?.rawScore !== undefined
        ? `درجة الجودة ${round(row.quality.rawScore)}% بوزن ${row.quality.weight}%`
        : 'لا توجد درجة جودة للفترة',
    );
    if (deductions.length > 0) {
      summaryParts.push(`${deductions.length} خصم نقاط بإجمالي ${pointsDeducted} نقطة`);
    } else {
      summaryParts.push('بدون خصومات نقاط');
    }
    if (bonuses.length > 0) {
      summaryParts.push(`${bonuses.length} مكافأة`);
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
      deductionCount: deductions.length,
      pointsDeducted,
      deductionReasons: reasonLines.join('\n'),
      evidenceRefs: evidences.join('\n'),
      summary: summaryParts.join(' — '),
      archived: row.archivedButEligible,
    };
  });

  // Employees ordered alphabetically (Arabic) — a master directory.
  rows.sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'ar'));

  const dataMode: ReportDataModeInfo = {
    dataMode: report.valueBasis === 'FINALIZED' ? 'snapshot' : 'live',
    source: 'kpi-engine + qualityObservations (KPI points domain)',
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
      totalPointsDeducted: round(rows.reduce((s, r) => s + r.pointsDeducted, 0)),
      avgQualityScore: rows.filter((r) => r.qualityScore !== null).length > 0
        ? round(rows.reduce((s, r) => s + (r.qualityScore ?? 0), 0) / rows.filter((r) => r.qualityScore !== null).length)
        : 0,
    },
    hasData: rows.length > 0,
    dataMode,
  };
}
