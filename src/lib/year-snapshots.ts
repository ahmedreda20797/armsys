// ══════════════════════════════════════════════════════════════
//  Year Closing — Annual Snapshot Service (§16)
//
//  Closes a fiscal year by composing all monthSnapshots documents
//  from the year into a SINGLE annual record. Once a year is closed:
//    • No month in that year can be reopened (frozen lineage).
//    • Annual comparison (vs prior year) becomes available.
//    • The annual summary aggregates KPI averages, deduction totals,
//      top departments, and per-employee annual records.
//
//  The annual record is stored in `annualSnapshots/{year}` and is
//  READ-ONLY once written (similar to monthSnapshots).
// ══════════════════════════════════════════════════════════════

import { getAll, getById, createRecordWithId, updateRecord, TTL } from '@/lib/db';
import { MONTH_SNAPSHOTS_TABLE } from '@/lib/month-lock';

export const ANNUAL_SNAPSHOTS_TABLE = 'annualSnapshots';

export interface AnnualKpiAverage {
  averageQualityScore: number | null;
  averageKpiScore: number | null;
  totalDeductions: number;
  totalDeductionDays: number;
  totalDeductionAmount: number;
  averageBonusPoints: number;
}

export interface AnnualDepartmentStats {
  department: string;
  employeeCount: number;
  averageScore: number | null;
  deductionCount: number;
}

export interface AnnualEmployeeRecord {
  employeeId: string;
  employeeName: string;
  department: string | null;
  averageQualityScore: number | null;
  averageKpiScore: number | null;
  totalDeductions: number;
  totalDeductionDays: number;
  totalDeductionAmount: number;
  totalBonus: number;
  availableMonths: number;
  totalMonths: number;
}

export interface AnnualSnapshot {
  id: string; // = year (e.g. "2026")
  year: number;
  status: 'open' | 'closed';
  monthCount: number;
  closedMonths: number;
  averageKpi: AnnualKpiAverage;
  departments: AnnualDepartmentStats[];
  employees: AnnualEmployeeRecord[];
  closedAt: string | null;
  closedBy: string | null;
  closedByName: string | null;
  reopenCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Build the annual record from existing month snapshots. */
function buildAnnualSnapshot(year: number, monthSnapshots: any[]): AnnualSnapshot {
  const yearMonths = monthSnapshots.filter((m) => {
    const monthKey = m.monthKey ?? m.id ?? '';
    return monthKey.startsWith(`${year}-`);
  });

  const closedMonths = yearMonths.filter((m) => m.status === 'closed');

  // ── Aggregate KPI averages across all closed months ──
  let totalQualityScore = 0;
  let qualityCount = 0;
  let totalKpiScore = 0;
  let kpiCount = 0;
  let totalDeductions = 0;
  let totalDeductionDays = 0;
  let totalDeductionAmount = 0;
  let totalBonusPoints = 0;

  for (const month of closedMonths) {
    const scores = month.kpiResults?.aggregateScores ?? month.aggregateScores ?? [];
    if (scores.length > 0) {
      const sum = scores.reduce((s: number, r: { score: number }) => s + r.score, 0);
      totalQualityScore += sum / scores.length;
      qualityCount += 1;
    }

    const summaries = month.summaries ?? month.kpiResults?.summaries ?? [];
    for (const s of summaries) {
      if (typeof s.weightedTotal === 'number' && Number.isFinite(s.weightedTotal)) {
        totalKpiScore += s.weightedTotal;
        kpiCount += 1;
      }
    }

    totalDeductions += month.deductionCount ?? 0;
    totalDeductionDays += month.totalDeductionDays ?? 0;
    totalDeductionAmount += month.totalDeductionAmount ?? 0;
    totalBonusPoints += month.totalBonusPoints ?? 0;
  }

  const averageKpi: AnnualKpiAverage = {
    averageQualityScore: qualityCount > 0 ? round(totalQualityScore / qualityCount) : null,
    averageKpiScore: kpiCount > 0 ? round(totalKpiScore / kpiCount) : null,
    totalDeductions,
    totalDeductionDays: round(totalDeductionDays),
    totalDeductionAmount: round(totalDeductionAmount),
    averageBonusPoints: round(totalBonusPoints),
  };

  // ── Per-department aggregation ──
  const deptMap = new Map<string, AnnualDepartmentStats>();
  for (const month of closedMonths) {
    const depts = month.departmentStats ?? month.kpiResults?.departmentStats ?? [];
    for (const d of depts) {
      const key = d.department ?? 'غير محدد';
      const existing = deptMap.get(key) ?? {
        department: key,
        employeeCount: 0,
        averageScore: 0,
        deductionCount: 0,
      };
      existing.employeeCount += d.employeeCount ?? 0;
      existing.deductionCount += d.deductionCount ?? 0;
      if (typeof d.averageScore === 'number') existing.averageScore = ((existing.averageScore as number) || 0) + d.averageScore;
      deptMap.set(key, existing);
    }
  }
  const departments: AnnualDepartmentStats[] = [...deptMap.values()].map((d) => ({
    ...d,
    averageScore: (d.averageScore ?? 0) > 0 ? round(d.averageScore as number) : null,
  })).sort((a, b) => (b.averageScore ?? 0) - (a.averageScore ?? 0));

  // ── Per-employee aggregation ──
  const empMap = new Map<string, AnnualEmployeeRecord>();
  for (const month of closedMonths) {
    const scores = month.kpiResults?.aggregateScores ?? month.aggregateScores ?? [];
    for (const s of scores) {
      if (!s.employeeId) continue;
      const existing = empMap.get(s.employeeId) ?? {
        employeeId: s.employeeId,
        employeeName: s.employeeName ?? '',
        department: s.department ?? null,
        averageQualityScore: 0,
        averageKpiScore: 0,
        totalDeductions: 0,
        totalDeductionDays: 0,
        totalDeductionAmount: 0,
        totalBonus: 0,
        availableMonths: 0,
        totalMonths: yearMonths.length,
      };
      existing.averageQualityScore = ((existing.averageQualityScore ?? 0) as number) + (s.score ?? 0);
      existing.availableMonths += 1;
      empMap.set(s.employeeId, existing);
    }
  }
  const employees: AnnualEmployeeRecord[] = [...empMap.values()].map((e) => ({
    ...e,
    averageQualityScore: e.availableMonths > 0 ? round((e.averageQualityScore ?? 0) / e.availableMonths) : null,
  })).sort((a, b) => (b.averageQualityScore ?? 0) - (a.averageQualityScore ?? 0));

  const now = new Date().toISOString();

  return {
    id: String(year),
    year,
    status: closedMonths.length === 12 ? 'closed' : 'open',
    monthCount: yearMonths.length,
    closedMonths: closedMonths.length,
    averageKpi,
    departments,
    employees,
    closedAt: null,
    closedBy: null,
    closedByName: null,
    reopenCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/** List all annual snapshots. */
export async function listAnnualSnapshots(): Promise<AnnualSnapshot[]> {
  const records = await getAll<AnnualSnapshot>(ANNUAL_SNAPSHOTS_TABLE, TTL.DEFAULT);
  return records.sort((a, b) => b.year - a.year);
}

/** Get one annual snapshot by year. */
export async function getAnnualSnapshotByYear(year: number): Promise<AnnualSnapshot | null> {
  return getById<AnnualSnapshot>(ANNUAL_SNAPSHOTS_TABLE, String(year));
}

/** Compute (and persist) the annual snapshot for a year. */
export async function computeAnnualSnapshot(year: number): Promise<AnnualSnapshot> {
  const monthSnapshots = await getAll<any>(MONTH_SNAPSHOTS_TABLE, TTL.DEFAULT);
  const annual = buildAnnualSnapshot(year, monthSnapshots);
  await createRecordWithId(ANNUAL_SNAPSHOTS_TABLE, String(year), annual as unknown as Record<string, unknown>);
  return annual;
}

/** Close a year (mark as closed; freezes all months in that year). */
export async function closeYear(
  year: number,
  actor: { id: string; name: string }
): Promise<AnnualSnapshot> {
  const monthSnapshots = await getAll<any>(MONTH_SNAPSHOTS_TABLE, TTL.DEFAULT);
  const annual = buildAnnualSnapshot(year, monthSnapshots);
  const now = new Date().toISOString();

  // Mark all months in this year as closed (if not already)
  for (const month of monthSnapshots) {
    const monthKey = month.monthKey ?? month.id ?? '';
    if (monthKey.startsWith(`${year}-`) && month.status !== 'closed') {
      await updateRecord(MONTH_SNAPSHOTS_TABLE, monthKey, {
        status: 'closed',
        closedAt: now,
        closedBy: actor.id,
        closedByName: actor.name,
        updatedAt: now,
      });
    }
  }

  const closedAnnual: AnnualSnapshot = {
    ...annual,
    status: 'closed',
    closedAt: now,
    closedBy: actor.id,
    closedByName: actor.name,
    updatedAt: now,
  };

  await createRecordWithId(ANNUAL_SNAPSHOTS_TABLE, String(year), closedAnnual as unknown as Record<string, unknown>);
  return closedAnnual;
}

/** Reopen a closed year (unfreezes all months in that year). */
export async function reopenYear(
  year: number,
  actor: { id: string; name: string },
  reason: string
): Promise<AnnualSnapshot> {
  const existing = await getAnnualSnapshotByYear(year);
  if (!existing) throw new Error(`Annual snapshot for year ${year} not found`);
  if (existing.status !== 'closed') throw new Error('Year is not closed');

  const monthSnapshots = await getAll<any>(MONTH_SNAPSHOTS_TABLE, TTL.DEFAULT);
  const now = new Date().toISOString();

  // Reopen all months in this year
  for (const month of monthSnapshots) {
    const monthKey = month.monthKey ?? month.id ?? '';
    if (monthKey.startsWith(`${year}-`)) {
      await updateRecord(MONTH_SNAPSHOTS_TABLE, monthKey, {
        status: 'open',
        closedAt: null,
        closedBy: null,
        closedByName: null,
        reopenReason: reason,
        reopenCount: (month.reopenCount ?? 0) + 1,
        updatedAt: now,
      });
    }
  }

  const reopened: AnnualSnapshot = {
    ...existing,
    status: 'open',
    closedAt: null,
    closedBy: null,
    closedByName: null,
    reopenCount: existing.reopenCount + 1,
    updatedAt: now,
  };

  await updateRecord(ANNUAL_SNAPSHOTS_TABLE, String(year), reopened as unknown as Record<string, unknown>);
  return reopened;
}

/** Compare two years side-by-side. */
export interface AnnualComparison {
  yearA: number;
  yearB: number;
  a: AnnualSnapshot | null;
  b: AnnualSnapshot | null;
  deltas: {
    averageQualityScore: number | null;
    averageKpiScore: number | null;
    totalDeductions: number | null;
    totalDeductionDays: number | null;
    totalDeductionAmount: number | null;
  } | null;
}

export async function compareYears(yearA: number, yearB: number): Promise<AnnualComparison> {
  const [a, b] = await Promise.all([
    getAnnualSnapshotByYear(yearA),
    getAnnualSnapshotByYear(yearB),
  ]);

  let deltas: AnnualComparison['deltas'] = null;
  if (a && b) {
    const safe = (x: number | null, y: number | null) =>
      x === null || y === null ? null : round(x - y);
    deltas = {
      averageQualityScore: safe(a.averageKpi.averageQualityScore, b.averageKpi.averageQualityScore),
      averageKpiScore: safe(a.averageKpi.averageKpiScore, b.averageKpi.averageKpiScore),
      totalDeductions: safe(a.averageKpi.totalDeductions, b.averageKpi.totalDeductions),
      totalDeductionDays: safe(a.averageKpi.totalDeductionDays, b.averageKpi.totalDeductionDays),
      totalDeductionAmount: safe(a.averageKpi.totalDeductionAmount, b.averageKpi.totalDeductionAmount),
    };
  }

  return { yearA, yearB, a, b, deltas };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
